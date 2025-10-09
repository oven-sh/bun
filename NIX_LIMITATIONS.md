# Nix Flake Limitations

## Current Status

The Nix flake is **syntactically correct** and provides all necessary dependencies (LLVM 19, CMake, Node.js 24, etc.), but has **not been tested to successfully compile Bun** yet.

## Known Issues

### glibc Compatibility (Non-NixOS Systems)

On non-NixOS Linux systems, you may encounter glibc compatibility errors:

```
/bin/sh: symbol lookup error: .../glibc-2.40-66/lib/libc.so.6: undefined symbol: __nptl_change_stack_perm
```

This occurs because:
1. Nix uses its own glibc (2.40)
2. System binaries (like `/bin/sh`) expect the system's glibc
3. When mixed, you get symbol conflicts

### Solutions

#### Option 1: Use NixOS or NixOS Container

The flake will work best on:
- NixOS (native)
- Docker/Podman with NixOS image
- NixOS VM

#### Option 2: FHS Environment (Included but Untested)

The flake includes a `buildFHSEnv` wrapper that should solve this, but it hasn't been verified to work for building Bun yet.

To try it:
```bash
nix develop  # Uses FHS environment by default
```

#### Option 3: Pure Nix Shell (For NixOS)

For NixOS users or debugging:
```bash
nix develop .#pure
```

## What Works

✅ Flake syntax is valid (`nix flake check` passes)
✅ All dependencies are declared
✅ Tools are available (clang, cmake, ninja, etc.)
✅ Environment variables are set correctly

## What Doesn't Work (Yet)

❌ Actual Bun compilation on non-NixOS systems
❌ FHS environment tested and verified
❌ Integration with `bun bd` command

## Testing Needed

To verify this works, someone needs to test on:
1. NixOS machine (native or VM)
2. Non-NixOS with the FHS environment
3. Actual `bun bd` build process end-to-end

## Why Ship This?

Even though it's not fully tested, this flake:
1. Provides a complete dependency specification
2. Can serve as documentation of what's needed
3. May work on NixOS (just needs testing)
4. Can be improved incrementally

## Contributing

If you get this working, please:
1. Document which platform you used
2. Share any fixes needed
3. Update this file with working configurations

## See Also

- [NIX_QUICKSTART.md](NIX_QUICKSTART.md) - Usage instructions
- [NIX_SETUP.md](NIX_SETUP.md) - Detailed setup
- [scripts/bootstrap.sh](scripts/bootstrap.sh) - Proven alternative
