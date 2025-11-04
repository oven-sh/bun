Bun provides an alternative package installation strategy called **isolated installs** that creates strict dependency isolation similar to pnpm's approach. This mode prevents phantom dependencies and ensures reproducible, deterministic builds.

## What are isolated installs?

Isolated installs create a non-hoisted dependency structure where packages can only access their explicitly declared dependencies. This differs from the traditional "hoisted" installation strategy used by npm and Yarn, where dependencies are flattened into a shared `node_modules` directory.

### Key benefits

- **Prevents phantom dependencies** — Packages cannot accidentally import dependencies they haven't declared
- **Deterministic resolution** — Same dependency tree regardless of what else is installed
- **Better for monorepos** — Workspace isolation prevents cross-contamination between packages
- **Reproducible builds** — More predictable resolution behavior across environments

## Using isolated installs

### Command line

Use the `--linker` flag to specify the installation strategy:

```bash
# Use isolated installs
$ bun install --linker isolated

# Use traditional hoisted installs
$ bun install --linker hoisted
```

### Configuration file

Set the default linker strategy in your `bunfig.toml`:

```toml
[install]
linker = "isolated"
```

### Default behavior

- **Workspaces**: Bun uses **isolated** installs by default to prevent hoisting-related bugs
- **Single projects**: Bun uses **hoisted** installs by default

To override the default, use `--linker hoisted` or `--linker isolated`, or set it in your configuration file.

## How isolated installs work

### Directory structure

Instead of hoisting dependencies, isolated installs create a two-tier structure:

```
node_modules/
├── .bun/                          # Central package store
│   ├── package@1.0.0/             # Versioned package installations
│   │   └── node_modules/
│   │       └── package/           # Actual package files
│   ├── @scope+package@2.1.0/      # Scoped packages (+ replaces /)
│   │   └── node_modules/
│   │       └── @scope/
│   │           └── package/
│   └── ...
└── package-name -> .bun/package@1.0.0/node_modules/package  # Symlinks
```

### Resolution algorithm

1. **Central store** — All packages are installed in `node_modules/.bun/package@version/` directories
2. **Symlinks** — Top-level `node_modules` contains symlinks pointing to the central store
3. **Peer resolution** — Complex peer dependencies create specialized directory names
4. **Deduplication** — Packages with identical package IDs and peer dependency sets are shared

### Workspace handling

In monorepos, workspace dependencies are handled specially:

- **Workspace packages** — Symlinked directly to their source directories, not the store
- **Workspace dependencies** — Can access other workspace packages in the monorepo
- **External dependencies** — Installed in the isolated store with proper isolation

## Comparison with hoisted installs

| Aspect                    | Hoisted (npm/Yarn)                         | Isolated (pnpm-like)                    |
| ------------------------- | ------------------------------------------ | --------------------------------------- |
| **Dependency access**     | Packages can access any hoisted dependency | Packages only see declared dependencies |
| **Phantom dependencies**  | ❌ Possible                                | ✅ Prevented                            |
| **Disk usage**            | ✅ Lower (shared installs)                 | ✅ Similar (uses symlinks)              |
| **Determinism**           | ❌ Less deterministic                      | ✅ More deterministic                   |
| **Node.js compatibility** | ✅ Standard behavior                       | ✅ Compatible via symlinks              |
| **Best for**              | Single projects, legacy code               | Monorepos, strict dependency management |

## Advanced features

### Peer dependency handling

Isolated installs handle peer dependencies through sophisticated resolution:

```bash
# Package with peer dependencies creates specialized paths
node_modules/.bun/package@1.0.0_react@18.2.0/
```

The directory name encodes both the package version and its peer dependency versions, ensuring each unique combination gets its own installation.

### Backend strategies

Bun uses different file operation strategies for performance:

- **Clonefile** (macOS) — Copy-on-write filesystem clones for maximum efficiency
- **Hardlink** (Linux/Windows) — Hardlinks to save disk space
- **Copyfile** (fallback) — Full file copies when other methods aren't available

### Debugging isolated installs

Enable verbose logging to understand the installation process:

```bash
$ bun install --linker isolated --verbose
```

This shows:

- Store entry creation
- Symlink operations
- Peer dependency resolution
- Deduplication decisions

## Troubleshooting

### Compatibility issues

Some packages may not work correctly with isolated installs due to:

- **Hardcoded paths** — Packages that assume a flat `node_modules` structure
- **Dynamic imports** — Runtime imports that don't follow Node.js resolution
- **Build tools** — Tools that scan `node_modules` directly

If you encounter issues, you can:

1. **Switch to hoisted mode** for specific projects:

   ```bash
   $ bun install --linker hoisted
   ```

2. **Report compatibility issues** to help improve isolated install support

### Performance considerations

- **Install time** — May be slightly slower due to symlink operations
- **Disk usage** — Similar to hoisted (uses symlinks, not file copies)
- **Memory usage** — Higher during install due to complex peer resolution

## Migration guide

### From npm/Yarn

```bash
# Remove existing node_modules and lockfiles
$ rm -rf node_modules package-lock.json yarn.lock

# Install with isolated linker
$ bun install --linker isolated
```

### From pnpm

Isolated installs are conceptually similar to pnpm, so migration should be straightforward:

```bash
# Remove pnpm files
$ rm -rf node_modules pnpm-lock.yaml

# Install with Bun's isolated linker
$ bun install --linker isolated
```

The main difference is that Bun uses symlinks in `node_modules` while pnpm uses a global store with symlinks.

## When to use isolated installs

**Isolated installs are the default for workspaces.** You may want to explicitly enable them for single projects when:

- Strict dependency management is required
- Preventing phantom dependencies is important
- Building libraries that need deterministic dependencies

**Switch to hoisted installs (including for workspaces) when:**

- Working with legacy code that assumes flat `node_modules`
- Compatibility with existing build tools is required
- Working in environments where symlinks aren't well supported
- You prefer the simpler traditional npm behavior

## Related documentation

- [Package manager > Workspaces](https://bun.com/docs/install/workspaces) — Monorepo workspace management
- [Package manager > Lockfile](https://bun.com/docs/install/lockfile) — Understanding Bun's lockfile format
- [CLI > install](https://bun.com/docs/cli/install) — Complete `bun install` command reference
