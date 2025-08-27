# Container Implementation Status

## Current State (as of this commit)

### What Actually Works ✅
- **User namespaces**: Basic functionality works with default UID/GID mapping
- **PID namespaces**: Process isolation works correctly
- **Network namespaces**: Basic isolation works (loopback only)
- **Mount namespaces**: Created but limited functionality
- **Cgroups v2**: CPU and memory limits work WITH ROOT ONLY
- **Basic overlayfs**: Simple read-only overlays work
- **Tmpfs**: Basic in-memory filesystems work
- **Clone3 integration**: Properly uses clone3 for all container features

### What's Broken or Incomplete ❌

#### Major Issues
1. **Cgroups require root**: No rootless cgroup support - fails with EACCES without sudo
2. **Complex overlayfs fails**: Only 1/5 overlayfs tests pass - issues with work_dir and upper_dir
3. **Pivot_root doesn't work**: Test fails, implementation likely incomplete
4. **chdir is disabled in containers**: Had to make it non-fatal because it fails with EACCES in user namespaces

#### Test Results (Reality Check)
```
container-basic.test.ts:         9/9 pass ✅
container-cgroups-only.test.ts:  2/2 pass ✅ (BUT REQUIRES ROOT)
container-cgroups.test.ts:       7/7 pass ✅ (BUT REQUIRES ROOT)
container-overlayfs-simple.test.ts: 3/3 pass ✅
container-simple.test.ts:        6/6 pass ✅
container-working-features.test.ts: 4/5 pass (pivot_root BROKEN)
container-overlayfs.test.ts:     1/5 pass (MOSTLY BROKEN)
```

### Architecture Decisions Made

1. **Always use clone3 for containers**: Even for cgroups-only, we use clone3 (not vfork) because we need synchronization between parent and child for proper setup timing.

2. **Fatal errors on container setup failure**: User explicitly requested no silent fallbacks - if cgroups fail, spawn fails.

3. **Sync pipes for coordination**: Parent and child coordinate via pipes to ensure cgroups are set up before child executes.

### Known Bugs and Gotchas

1. **Memory after clone3**: The child process after clone3 has copy-on-write memory, not shared like vfork. Be careful with pointers.

2. **UID/GID mapping timing**: Must be done by parent after clone3 but before child continues - tricky synchronization.

3. **Cgroup path assumptions**: C++ creates cgroups at `/sys/fs/cgroup/bun-*`, Zig expects them there. Don't change one without the other.

4. **SIGABRT in containers**: If you see exit code 134, it's probably chdir failing in the container. We made it non-fatal but check if that's still the case.

5. **Debug output removed**: Removed all fprintf debug statements in final commits. Add them back if debugging.

### What Needs To Be Done

#### High Priority
1. **Fix overlayfs tests**: Complex overlayfs with upper_dir and work_dir failing
2. **Fix pivot_root**: Implementation exists but doesn't work
3. **Rootless cgroups**: Investigate using systemd delegation or cgroup2 delegation for rootless
4. **Better error messages**: Currently just returns errno, could be more descriptive

#### Medium Priority
1. **Custom UID/GID mappings**: Currently only supports default mapping
2. **Network namespace configuration**: Only loopback works, no bridge networking
3. **Filesystem mount error handling**: Some mount operations fail silently
4. **Security tests**: No tests for privilege escalation or escape attempts

#### Low Priority
1. **Seccomp filters**: No syscall filtering implemented
2. **Capabilities**: No capability dropping
3. **AppArmor/SELinux**: No MAC integration
4. **Cgroup v1 fallback**: Only v2 supported

### File Structure
- `src/bun.js/bindings/bun-spawn.cpp`: Main spawn implementation with clone3, container setup
- `src/bun.js/api/bun/linux_container.zig`: Container context and Zig-side management
- `src/bun.js/api/bun/process.zig`: Integration with Bun.spawn API
- `test/js/bun/spawn/container-*.test.ts`: Container tests (some failing!)

### Critical Code Sections

#### Clone3 vs vfork decision (bun-spawn.cpp:833)
```cpp
// Use clone3 for ANY container features (namespaces or cgroups)
// Only use vfork when there's no container at all
if (request->container_setup) {
    // ... use clone3
} else {
    child = vfork();
}
```

#### Cgroup setup (bun-spawn.cpp:187)
```cpp
// Always creates at /sys/fs/cgroup/bun-*
// Fails with EACCES without root
// No fallback to user's cgroup hierarchy
```

#### chdir handling (bun-spawn.cpp:733)
```cpp
// Made non-fatal for containers because it fails in user namespaces
if (chdir(request->chdir) != 0) {
    if (!request->container_setup) {
        return childFailed();
    }
    // For containers, ignore chdir failures
}
```

### Testing Instructions

```bash
# Build first (takes ~5 minutes)
bun bd

# Run tests WITH ROOT (required for cgroups)
sudo bun bd test test/js/bun/spawn/container-simple.test.ts  # Should pass
sudo bun bd test test/js/bun/spawn/container-cgroups-only.test.ts  # Should pass
sudo bun bd test test/js/bun/spawn/container-overlayfs.test.ts  # WILL FAIL (4/5 tests)

# Without root - cgroups will fail
bun bd test test/js/bun/spawn/container-cgroups-only.test.ts  # Fails with EACCES
```

### Honest Assessment

**The Good**: Core container functionality works. Namespaces are properly implemented, basic isolation works, and the architecture is sound.

**The Bad**: Requires root for cgroups, complex filesystem operations are broken, and there are definitely edge cases we haven't found yet.

**The Ugly**: This is NOT production-ready. It's a proof of concept that works for basic cases but needs significant hardening before real use. Don't trust it for security-critical applications.

### For Next Developer

Start by:
1. Running the tests to see what's actually broken
2. Add back debug fprintf statements when debugging (grep for "fprintf.*stderr" in git history)
3. Test with AND without root to understand permission issues
4. Read the clone3 man page - it's complicated
5. Expect surprises with overlayfs - it has many subtle requirements

Good luck! The foundation is solid but there's work to do.
