# Bun Filesystem-Aware Cache Implementation Plan

## Goal
Implement filesystem detection logic for Bun's cache directory so that the cache is placed on the same mount/filesystem as the install location (node_modules). This will enable efficient hardlink creation during package installation.

## Current State
- Bun's cache location is determined by environment variables and defaults to `~/.bun/install/cache`
- The cache location is static and doesn't adapt based on the install destination
- Bun already handles filesystem boundaries for temp directories but not for the cache itself

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create a new utility module for filesystem detection (e.g., `src/install/filesystem_utils.zig`)
  - [ ] Implement `getMountPoint(path: string)` - detect the filesystem mount point of a given path
  - [ ] Implement `isSameFilesystem(path1: string, path2: string)` - compare filesystem IDs using stat
  - [ ] Add platform-specific implementations (Linux, macOS, Windows)

### Phase 2: Filesystem Detection Logic
- [ ] Implement filesystem comparison using stat:
  - [ ] Get filesystem ID (st_dev) for both cache and install directories
  - [ ] Compare filesystem IDs to determine if they're on the same mount
  - [ ] If different, find the filesystem root/mount point for the install dir
  - [ ] Cache the filesystem detection results to avoid repeated stat calls

### Phase 3: Modify Cache Directory Resolution
- [ ] Update `fetchCacheDirectoryPath()` in `PackageManagerDirectories.zig`:
  - [ ] Add new parameter: `install_dir: ?string` (the destination node_modules directory)
  - [ ] Add new return field to indicate if cache is on same filesystem as install
  - [ ] Implement fallback logic when install_dir is provided:
    1. Check if default cache can hardlink to install_dir
    2. If not, find the mount point of install_dir
    3. Walk down from mount point toward project, testing each level:
       - Try `<mount_point>/.bun-cache`
       - Try `<mount_point>/<first_dir>/.bun-cache`
       - Continue until reaching parent of project directory
    4. Use the first writable location found
    5. Fall back to project-local cache if no suitable location found

### Phase 4: Update Cache Directory Initialization
- [ ] Modify `ensureCacheDirectory()` to:
  - [ ] Accept the install directory parameter
  - [ ] Perform filesystem detection when needed
  - [ ] Create filesystem-specific cache directories
  - [ ] Add logging for cache location decisions

### Phase 5: Integration Points
- [ ] Update all callers of `getCacheDirectory()` to pass install context when available
- [ ] Ensure temp directory logic remains compatible with new cache locations
- [ ] Update package extraction to leverage same-filesystem benefits

### Phase 6: Configuration & Environment Variables
- [ ] Add new environment variable: `BUN_INSTALL_CACHE_STRATEGY` with options:
  - `static` (current behavior - always use configured cache)
  - `auto` (new behavior - adapt based on filesystem)
  - `local` (always use project-local cache)
- [ ] Ensure existing env vars (`BUN_INSTALL_CACHE_DIR`, etc.) take precedence
- [ ] Add config option in bunfig.toml

### Phase 7: Error Handling & Edge Cases
- [ ] Handle permission errors when creating mount-point caches
- [ ] Handle read-only filesystems
- [ ] Handle network filesystems (detect and warn about performance)
- [ ] Implement cache migration when filesystem changes
- [ ] Add cleanup for abandoned filesystem-specific caches

### Phase 8: Testing
- [ ] Unit tests for filesystem detection utilities
- [ ] Integration tests with mock filesystems
- [ ] Test cross-filesystem install scenarios
- [ ] Test fallback behavior when filesystem detection fails
- [ ] Performance benchmarks comparing hardlink vs copy

### Phase 9: Documentation & Logging
- [ ] Add verbose logging for cache location decisions
- [ ] Document the new caching strategy in Bun docs
- [ ] Add warning messages for suboptimal cache locations
- [ ] Create migration guide for users with existing caches

## Technical Details

### Cache Location Strategy Examples

**Unix example** - Given a project at `/home/user/projects/my-app/node_modules`:

1. **Best case**: Default cache at `~/.bun/install/cache` is on same filesystem
   - Result: Use `~/.bun/install/cache`

2. **Different filesystem**: Project is on `/mnt/projects` mount
   - Try: `/mnt/.bun-cache` (often not writable)
   - Try: `/mnt/projects/.bun-cache` (might be writable)
   - Try: `/mnt/projects/my-app/.bun-cache` (likely writable)
   - Result: Use first writable location found

**Windows example** - Given a project at `D:\projects\my-app\node_modules`:

1. **Best case**: Default cache at `C:\Users\alice\.bun\install\cache` and project on `C:` drive
   - Result: Use default cache

2. **Different drive**: Project is on `D:` drive
   - Try: `D:\.bun-cache` (might not be writable)
   - Try: `D:\projects\.bun-cache` (likely writable)
   - Result: Use first writable location found

3. **Benefits of walking down**:
   - `/mnt/projects/.bun-cache` or `D:\projects\.bun-cache` can be shared by all projects on that mount/drive
   - Better than jumping straight to project-local cache
   - Maximizes cache reuse while respecting filesystem boundaries

### Filesystem Detection Algorithm
```zig
// Pseudo-code for the main logic
fn determineOptimalCacheDir(install_dir: string, default_cache: string) !string {
    // 1. Check if default cache is on same filesystem using stat
    if (try isSameFilesystem(default_cache, install_dir)) {
        return default_cache;
    }
    
    // 2. Find mount point of install directory
    const mount_point = try getMountPoint(install_dir);
    
    // 3. Walk down from mount point to find best cache location
    var current_path = mount_point;
    const install_parent = path.dirname(install_dir);
    
    while (true) {
        const cache_path = path.join(current_path, ".bun-cache");
        
        // Try to create cache directory at this level
        if (canCreateDir(cache_path)) {
            return cache_path;
        }
        
        // Stop if we've reached the install directory's parent
        if (current_path == install_parent) {
            break;
        }
        
        // Move down one level toward the project
        const next_component = getNextPathComponent(current_path, install_dir);
        if (next_component == null) break;
        
        current_path = path.join(current_path, next_component);
    }
    
    // 4. Last resort: project-local cache
    return path.join(install_parent, ".bun-cache");
}

// Helper to check if paths are on same filesystem
fn isSameFilesystem(path1: string, path2: string) !bool {
    if (builtin.os.tag == .windows) {
        // Windows: Compare volume serial numbers
        var volume1: [bun.MAX_PATH_BYTES]u8 = undefined;
        var volume2: [bun.MAX_PATH_BYTES]u8 = undefined;
        
        _ = try bun.windows.GetVolumePathNameW(path1, &volume1);
        _ = try bun.windows.GetVolumePathNameW(path2, &volume2);
        
        // If volume paths are different (C:\ vs D:\), different filesystem
        if (!std.mem.eql(u8, volume1, volume2)) return false;
        
        // For same volume, could also check with GetFileInformationByHandle
        // for network drives or subst drives
        return true;
    } else {
        // Unix: Compare device IDs
        const stat1 = try std.fs.cwd().statFile(path1);
        const stat2 = try std.fs.cwd().statFile(path2);
        return stat1.dev == stat2.dev;
    }
}
```

### Platform Considerations
- **Linux**: Use `stat()` and compare `st_dev` fields
- **macOS**: Similar to Linux, may need to handle APFS volumes
- **Windows**: Different approach needed:
  - Use `GetVolumePathName()` to find volume mount points (e.g., `C:\`, `D:\`)
  - Use `GetVolumeInformation()` to get volume serial numbers for comparison
  - Alternative: Use `GetFileInformationByHandle()` which provides `dwVolumeSerialNumber`
  - Note: Windows typically uses drive letters, making mount point detection simpler

### Performance Considerations
- Cache filesystem detection results per install session
- Minimize filesystem operations during detection
- Provide option to disable detection for CI/containers

## Success Criteria
- [ ] Hardlinks work for most package installations
- [ ] No performance regression for single-filesystem setups
- [ ] Clear error messages when hardlinks aren't possible
- [ ] Backward compatibility with existing cache locations