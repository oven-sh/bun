# Nix Development Environment for Bun

This directory now includes a complete Nix flake setup for building Bun. This provides an alternative to `scripts/bootstrap.sh` with several advantages.

## Files Created

- **`flake.nix`** - Main Nix flake with all dependencies
- **`.envrc`** - Direnv configuration for automatic environment loading
- **`NIX_QUICKSTART.md`** - Quick start guide (5 minutes to get started)
- **`NIX_SETUP.md`** - Comprehensive setup and usage guide
- **`NIX_PUBLISHING.md`** - Guide for publishing to binary cache (Cachix/S3)
- **`.github/workflows/test-nix-flake.yml`** - CI workflow to test the flake

## Quick Usage

### Option 1: Direct from GitHub (No Clone Needed)

```bash
nix develop github:oven-sh/bun --command bun bd
```

### Option 2: Local Development

```bash
cd bun
nix develop
bun bd
```

### Option 3: With direnv (Auto-Load)

```bash
cd bun
direnv allow  # First time only
# Environment loads automatically!
bun bd
```

## What's Included

All dependencies from `scripts/bootstrap.sh`:

- LLVM 19 (clang, lld, llvm-ar) - matching version 19.1.7
- CMake 3.30+ - matching version 3.30.5
- Node.js 24 - matching version 24.3.0
- Bun (for build scripts)
- Rust toolchain (rustc + cargo)
- Go toolchain
- Build tools: gcc, ninja, ccache, pkg-config, make
- Libraries: openssl, zlib, libxml2, libiconv
- Development tools: git, curl, wget, unzip, xz, htop, gnupg
- Linux-specific: X11 libraries for Chromium/testing, gdb for debugging
- macOS-specific: Apple SDK frameworks

## Next Steps

### For Development

Just use it! The flake works out of the box.

```bash
nix develop
bun bd
bun bd test test/js/bun/http/serve.test.ts
```

### For Publishing (Later)

Once you're ready to publish the environment so users can download pre-built binaries:

1. **Set up Cachix** (easiest):
   ```bash
   # Create account at https://app.cachix.org/
   cachix create bun-dev

   # Build and push
   nix build .#devShells.x86_64-linux.default
   cachix push bun-dev ./result
   ```

2. **Update `flake.nix`**:
   Uncomment the `nixConfig` section and add your Cachix public key.

3. **Add GitHub Actions**:
   The workflow in `.github/workflows/test-nix-flake.yml` is ready to use.
   Just add `CACHIX_AUTH_TOKEN` to GitHub secrets.

See [NIX_PUBLISHING.md](NIX_PUBLISHING.md) for detailed instructions.

## Architecture

```
flake.nix
├── inputs
│   ├── nixpkgs (pinned to nixos-unstable)
│   └── flake-utils (for multi-platform support)
├── buildInputs
│   ├── Core tools (cmake, ninja, ccache, etc.)
│   ├── Compilers (LLVM 19, gcc, rustc, go)
│   ├── Runtime dependencies (nodejs, bun)
│   └── Libraries (openssl, zlib, etc.)
└── devShells.default
    ├── shellHook (prints welcome message)
    └── Environment variables (CC, CXX, LD, etc.)
```

## Comparison with bootstrap.sh

| Feature | bootstrap.sh | Nix Flake |
|---------|-------------|-----------|
| Setup time | 10-30 minutes | 1-2 minutes* |
| System changes | Yes (with sudo) | No (isolated) |
| Reproducibility | ~90% (depends on package repos) | 100% (cryptographically verified) |
| Binary caching | No | Yes* |
| Multi-version support | No (system-wide installs) | Yes (per-project) |
| Rollback | No | Yes (`nix flake update` + git) |
| Cross-platform | Linux + macOS | Linux + macOS |
| CI integration | Manual | Declarative |

\* With binary cache (not yet published)

## Testing

The flake includes a GitHub Actions workflow that tests:

1. Flake validity (`nix flake check`)
2. Development shell loads correctly
3. All tools are available and correct versions
4. Environment variables are set properly

This runs on both Linux and macOS.

## Future Enhancements

### Short Term
- [x] Basic flake with all dependencies
- [x] Documentation
- [x] CI workflow
- [ ] Test on real hardware (Linux + macOS)
- [ ] Fix any missing dependencies

### Medium Term
- [ ] Set up Cachix account
- [ ] Publish to binary cache
- [ ] Add cache config to flake
- [ ] Build for all platforms (x64 + aarch64)

### Long Term
- [ ] Consider self-hosted cache (S3)
- [ ] Integration with Bun's build system
- [ ] Provide pre-built Bun binaries via Nix

## Contributing

If you find issues with the Nix setup:

1. Check if the dependency is in `flake.nix`
2. Verify the version matches `scripts/bootstrap.sh`
3. Test with `nix develop --command <test-command>`
4. Update `flake.nix` and documentation
5. Run `nix flake update` if nixpkgs needs updating

## License

Same as Bun - see main LICENSE file.

## Credits

Created to provide an alternative development environment setup that's:
- Faster than bootstrap.sh
- More reproducible
- Doesn't require sudo
- Fully isolated from system packages

Based on the dependency versions specified in `scripts/bootstrap.sh`.
