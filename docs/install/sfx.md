# Self-Extracting Executables for Bun

Bun provides true self-extracting executables for Linux that require **zero dependencies** - not even a shell. These are native binaries that contain the Bun executable embedded within them.

## Linux

### Download and Run

Download the appropriate executable for your system and run it directly:

**x64 (with AVX2 support):**

```bash
curl -LO https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64
chmod +x bun-linux-x64
./bun-linux-x64
```

**x64 (baseline - no AVX2):**

```bash
curl -LO https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-baseline
chmod +x bun-linux-x64-baseline
./bun-linux-x64-baseline
```

**ARM64/AArch64:**

```bash
curl -LO https://github.com/oven-sh/bun/releases/latest/download/bun-linux-aarch64
chmod +x bun-linux-aarch64
./bun-linux-aarch64
```

### Custom Installation Directory

By default, Bun installs to `$HOME/.bun/bin`. You can override this:

```bash
BUN_INSTALL_DIR=/usr/local/bin ./bun-linux-x64
```

## How It Works

The self-extracting executables are true native binaries:

1. **Native Binary**: Written in C and compiled to a static executable
2. **Embedded Bun**: The Bun executable is compressed and embedded directly in the binary
3. **Zero Dependencies**: Statically linked - requires absolutely nothing to run
4. **Small Size**: Uses UPX compression to minimize file size

When you run the executable, it:

1. Creates the installation directory
2. Decompresses the embedded Bun binary
3. Writes it to disk with proper permissions
4. Verifies the installation
5. Provides PATH setup instructions

## Advantages

- **Zero Dependencies**: No shell, no tar, no gzip, no base64 - nothing required
- **Single File**: One self-contained executable
- **Secure**: Checksums provided for verification
- **Universal**: Works on any Linux system with the matching architecture
- **Fast**: Native code extraction is faster than shell scripts

## Verification

Always verify downloads using the provided checksums:

```bash
# Download checksum
curl -LO https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.sha256

# Verify
sha256sum -c bun-linux-x64.sha256
```

## Technical Details

The self-extracting executables are built using:

- **Language**: C
- **Compression**: zlib (gzip compatible)
- **Executable Compression**: UPX with LZMA
- **Linking**: Static (no shared library dependencies)
- **Cross-compilation**: Supports x64 and aarch64 targets
