# Isolated Installs

Bun's isolated installs feature provides a modern alternative to the traditional "hoisted" package installation strategy. It addresses the "phantom dependency" problem, improves installation parallelization, and significantly boosts performance on Windows while conserving disk space through intelligent use of symlinks.

## Overview

Traditional package managers like npm use a "hoisted" installation strategy where dependencies are flattened into a single `node_modules` directory. This can lead to:

- **Phantom dependencies**: Packages can accidentally import dependencies they don't explicitly declare
- **Version conflicts**: Different packages may require incompatible versions of the same dependency
- **Slower installations**: Dependencies must be installed sequentially to avoid conflicts

Isolated installs solve these problems by giving each package its own isolated dependency tree while using symlinks to share identical packages across the project.

## Key Benefits

- **🚫 Eliminates phantom dependencies**: Each package can only access its explicitly declared dependencies
- **🚀 Up to 8x faster on Windows**: Optimized file system operations and parallelization
- **⚡ Parallel installation**: Dependencies install concurrently when their requirements are met
- **💾 Disk space savings**: Symlinks prevent duplicate installations of identical packages
- **🔒 Better isolation**: Each package version gets its own directory structure
- **🧵 Sophisticated peer dependency handling**: Advanced resolution for complex dependency graphs

## Configuration

Isolated installs are configured through your `package.json` file using the `nodeLinker` option within the `workspaces` section:

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "workspaces": {
    "nodeLinker": "isolated"
  }
}
```

### Available Options

- **`"isolated"`** - Use isolated installation strategy with symlinks
- **`"hoisted"`** - Use traditional hoisted installation (default for single packages)
- **`"auto"`** - Automatically choose isolated for workspaces, hoisted for single packages

## Directory Structure

Isolated installs create a unique directory structure that provides isolation while enabling sharing:

```
node_modules/
├── .bun/                                    # Package store
│   ├── package@1.0.0/                      # Version-specific store entry
│   │   └── node_modules/
│   │       └── package/                     # Actual package files
│   ├── package@1.0.0+peer123/              # With peer dependencies
│   │   └── node_modules/
│   │       └── package/
│   └── node_modules/                        # Global symlinks
│       └── package -> ../package@1.0.0/node_modules/package
└── package -> .bun/package@1.0.0/node_modules/package
```

### How It Works

1. **Store Directory**: The `.bun` directory contains the actual package files, organized by version and peer dependency hash
2. **Symlinks**: The main `node_modules` contains symlinks pointing to the appropriate store entries
3. **Deduplication**: Identical packages (same version and peer dependencies) are shared across the project
4. **Isolation**: Each package can only access its declared dependencies through the symlink structure

## Performance Characteristics

### Parallelization

Isolated installs use a sophisticated task-based system that allows packages to install in parallel:

- Dependencies install concurrently when their requirements are met
- A blocking/unblocking mechanism coordinates dependency relationships
- Thread pool optimization maximizes CPU utilization

### Windows Optimizations

- Uses junctions as fallback for symlinks on Windows
- Optimized file system operations for Windows compatibility
- Significantly faster than traditional hoisted installs on Windows systems

### Deduplication

The system performs intelligent deduplication:

- Early deduplication for leaf packages and linked dependencies
- Peer-aware deduplication reduces node count significantly
- Example: A large monorepo reduced from 772,471 to 314,022 nodes

## Workspaces Integration

Isolated installs work seamlessly with Bun's workspace feature:

```json
{
  "name": "my-monorepo",
  "workspaces": {
    "packages": ["packages/*"],
    "nodeLinker": "isolated"
  }
}
```

This configuration will:

- Install all workspace packages using isolated installs
- Share common dependencies across workspaces
- Maintain isolation between different workspace packages

## Peer Dependencies

Isolated installs include sophisticated peer dependency resolution:

- **Transitive peer tracking**: Handles complex peer dependency chains
- **Automatic resolution**: Resolves peer dependencies based on the dependency graph
- **Isolation preservation**: Ensures peer dependencies don't break package isolation

## Migration from Hoisted Installs

To migrate an existing project to isolated installs:

1. **Add configuration** to your `package.json`:

   ```json
   {
     "workspaces": {
       "nodeLinker": "isolated"
     }
   }
   ```

2. **Clean existing installation**:

   ```bash
   $ rm -rf node_modules
   $ rm bun.lock
   ```

3. **Reinstall with isolated strategy**:
   ```bash
   $ bun install
   ```

## Troubleshooting

### Common Issues

**Package can't find a dependency it was importing**

- This likely indicates a phantom dependency that wasn't properly declared
- Add the missing dependency to your `package.json`

**Symlink-related errors on Windows**

- Ensure you have appropriate permissions for creating symlinks
- Bun will automatically fallback to junctions when symlinks aren't available

**Performance seems slower than expected**

- Isolated installs may have initial overhead but should be faster overall
- Windows users should see significant performance improvements

### Debug Information

Enable debug logging to troubleshoot installation issues:

```bash
$ BUN_DEBUG_QUIET_LOGS=1 bun install
$ BUN_DEBUG_INSTALL=1 bun install  # Verbose install logging
```

## Compatibility

- **Node.js**: Fully compatible with Node.js projects
- **Existing tools**: Works with existing build tools and scripts
- **Workspaces**: Recommended for monorepo/workspace setups
- **Platform support**: Windows, macOS, and Linux

## When to Use

**Recommended for:**

- Monorepos and workspaces
- Projects with complex dependency graphs
- Windows development environments
- Teams concerned about phantom dependencies

**Consider hoisted installs for:**

- Simple single-package projects
- Legacy projects with phantom dependency assumptions
- Environments where symlinks aren't supported

## Technical Details

Isolated installs are implemented through:

- **Store management**: Efficient storage and retrieval of package versions
- **Symlink creation**: Cross-platform symlink and junction handling
- **Task coordination**: Parallel installation with dependency blocking
- **Peer resolution**: Advanced algorithm for peer dependency handling

For more technical details, refer to the implementation in `src/install/isolated_install.zig` and related files.
