# Building Bun with Nix

This directory contains a Nix flake that provides a complete development environment for building Bun. It's an alternative to `scripts/bootstrap.sh` and includes all the same dependencies pre-configured.

## Prerequisites

1. Install Nix with flakes enabled:
   ```bash
   # Install Nix (official installer)
   sh <(curl -L https://nixos.org/nix/install) --daemon

   # Enable flakes (add to ~/.config/nix/nix.conf or /etc/nix/nix.conf)
   experimental-features = nix-command flakes
   ```

2. (Optional) Install direnv for automatic environment loading:
   ```bash
   # Install direnv
   curl -sfL https://direnv.net/install.sh | bash

   # Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
   eval "$(direnv hook bash)"  # or zsh, fish, etc.
   ```

## Quick Start

### Option 1: Using direnv (Recommended)

If you have direnv installed, it will automatically load the Nix environment when you enter the directory:

```bash
cd /workspace/bun
direnv allow  # First time only
# Environment loads automatically
bun bd
```

### Option 2: Manual nix develop

```bash
cd /workspace/bun
nix develop

# Now you're in the development shell with all dependencies
bun bd
```

### Option 3: One-off commands

```bash
nix develop --command bun bd
nix develop --command bun bd test test/js/bun/http/serve.test.ts
```

## What's Included

The Nix flake provides:

- **LLVM 19** (matching bootstrap.sh version 19.1.7)
- **CMake** 3.30+ (matching bootstrap.sh version 3.30.5)
- **Node.js 24** (matching bootstrap.sh version 24.3.0)
- **Bun** (for running build scripts)
- **Rust** toolchain (rustc + cargo)
- **Go** toolchain
- **Build tools**: gcc, ninja, ccache, pkg-config
- **Development tools**: git, curl, wget, etc.
- **System libraries**: openssl, zlib, libxml2, etc.
- **Linux-specific**: X11 libraries for Chromium/testing, gdb for debugging
- **macOS-specific**: Apple SDK frameworks

## Environment Variables

The flake automatically sets:

- `CC=clang` (LLVM 19)
- `CXX=clang++` (LLVM 19)
- `AR=llvm-ar`
- `RANLIB=llvm-ranlib`
- `LD=lld`
- `CMAKE_BUILD_TYPE=Debug`
- `ENABLE_CCACHE=1`

## Building Bun

Once in the Nix shell:

```bash
# Build debug binary
bun bd

# Run tests with debug build
bun bd test test/js/bun/http/serve.test.ts

# Run any command with debug build
bun bd <command>
```

## Advantages over bootstrap.sh

1. **Reproducible**: Same versions across all machines
2. **Isolated**: Doesn't modify your system
3. **Fast**: Binary cache downloads instead of compiling
4. **Declarative**: All dependencies in one file
5. **Cross-platform**: Works on Linux and macOS
6. **No sudo**: Doesn't require root access

## Troubleshooting

### Flakes not enabled

If you get an error about experimental features:

```bash
# Add to ~/.config/nix/nix.conf
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

### Building from scratch

If you want to build without the binary cache:

```bash
nix develop --option substitute false
```

### Updating dependencies

To update all dependencies to their latest versions:

```bash
nix flake update
```

## Publishing the Environment

To eventually publish this as a cached build (so users don't need to rebuild):

1. The flake can be used directly from GitHub:
   ```bash
   nix develop github:oven-sh/bun
   ```

2. With Cachix (for binary caching):
   ```bash
   # Set up Cachix
   cachix use bun

   # Build and push to cache
   nix build .#devShells.x86_64-linux.default
   cachix push bun ./result
   ```

3. Users can then use the pre-built environment:
   ```bash
   nix develop github:oven-sh/bun --use-cachix bun
   ```

## Comparison with bootstrap.sh

| Feature | bootstrap.sh | Nix Flake |
|---------|-------------|-----------|
| Installs system-wide | Yes (requires sudo) | No (isolated) |
| Reproducible builds | Approximate | Exact |
| Binary caching | No | Yes |
| Version pinning | Script updates needed | Flake lock file |
| Cross-platform | Linux + macOS | Linux + macOS |
| Setup time | 10-30 minutes | 1-2 minutes (with cache) |
| Isolation | None | Full isolation |

## Notes

- The Nix environment is completely isolated and won't conflict with system packages
- You can have multiple Nix shells open with different versions of tools
- The `.envrc` file enables automatic environment loading with direnv
- All dependencies are declared in `flake.nix` and can be customized
