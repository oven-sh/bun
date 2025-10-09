# Nix Quick Start for Bun Development

Get up and running with Bun development using Nix in under 5 minutes.

## Prerequisites

Only Nix with flakes enabled. That's it.

```bash
# Install Nix (if not already installed)
sh <(curl -L https://nixos.org/nix/install) --daemon

# Enable flakes
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

## Quick Start

### One Command

```bash
nix develop github:oven-sh/bun --command bash -c "bun bd"
```

This will:
1. Download/build all dependencies
2. Enter the development environment
3. Build Bun debug binary

### Interactive Development

```bash
# Clone the repo (if you haven't already)
git clone https://github.com/oven-sh/bun.git
cd bun

# Enter the development shell
nix develop

# Now you have all dependencies!
bun bd                                    # Build debug binary
bun bd test http/serve.test.ts           # Run tests
bun bd --help                             # See other commands
```

### With direnv (Auto-Load)

Install direnv once:

```bash
# Install direnv
curl -sfL https://direnv.net/install.sh | bash

# Add to your shell (~/.bashrc, ~/.zshrc, etc.)
eval "$(direnv hook bash)"  # or zsh, fish, etc.
```

Then it just works:

```bash
cd bun
direnv allow  # First time only

# Environment is automatically loaded!
# No need to type "nix develop"
bun bd
```

## What You Get

All dependencies from `scripts/bootstrap.sh`:

- ✅ LLVM 19 (clang, lld, llvm-ar)
- ✅ CMake 3.30+
- ✅ Node.js 24
- ✅ Bun (for build scripts)
- ✅ Rust (rustc + cargo)
- ✅ Go
- ✅ Build tools (ninja, ccache, gcc)
- ✅ System libraries (openssl, zlib, etc.)
- ✅ Linux: X11 libs + gdb for debugging
- ✅ macOS: Apple SDK frameworks

Environment variables automatically set:

- `CC=clang` (LLVM 19)
- `CXX=clang++`
- `LD=lld`
- `CMAKE_BUILD_TYPE=Debug`

## Common Tasks

```bash
# Build Bun debug binary
bun bd

# Run a specific test
bun bd test test/js/bun/http/serve.test.ts

# Run test with filter
bun bd test serve.test.ts -t "should handle"

# Run any command with debug build
bun bd <command>

# Exit the Nix shell
exit  # or Ctrl+D
```

## Advantages

| | bootstrap.sh | Nix Flake |
|---|---|---|
| **Setup time** | 10-30 min | 1-2 min* |
| **Requires sudo** | Yes | No |
| **Isolated** | No | Yes |
| **Reproducible** | ~90% | 100% |
| **Binary cache** | No | Yes* |

\* With binary cache (not yet set up)

## Troubleshooting

### "experimental features not enabled"

```bash
# Add to your config
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

### Slow first time?

First time downloads/builds dependencies. Subsequent times are instant.

### Want to clear cache?

```bash
nix-collect-garbage -d
```

### Need help?

See detailed docs:
- [NIX_SETUP.md](NIX_SETUP.md) - Full setup guide
- [NIX_PUBLISHING.md](NIX_PUBLISHING.md) - Publishing to binary cache

## Comparison to bootstrap.sh

Nix flake is an **alternative** to `scripts/bootstrap.sh`, not a replacement:

- ✅ Use Nix if: You want isolation, reproducibility, and fast setup
- ✅ Use bootstrap.sh if: You prefer traditional system packages

Both work great! Choose what fits your workflow.

## What's Next?

Once you're in the Nix shell:

1. **Build Bun**: `bun bd`
2. **Run tests**: `bun bd test <test-file>`
3. **Make changes**: Edit code
4. **Rebuild**: `bun bd` again
5. **Test changes**: `bun bd test ...`

Happy hacking! 🚀
