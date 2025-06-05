# Self-Extracting Archives (SFX) for Bun

Self-extracting archives provide a convenient way to install Bun without requiring external tools like `unzip`. These are shell scripts that contain the Bun binary embedded within them.

## Linux

### Quick Install

For automatic architecture detection:

```bash
curl -fsSL https://github.com/oven-sh/bun/releases/latest/download/bun-linux-install.sh | sh
```

### Manual Installation

Choose the appropriate version for your system:

**x64 (with AVX2 support):**

```bash
curl -fsSL https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-sfx.sh | sh
```

**x64 (baseline - no AVX2):**

```bash
curl -fsSL https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-baseline-sfx.sh | sh
```

**ARM64/AArch64:**

```bash
curl -fsSL https://github.com/oven-sh/bun/releases/latest/download/bun-linux-aarch64-sfx.sh | sh
```

### Download and Run Later

You can also download the SFX file and run it later:

```bash
# Download
curl -LO https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-sfx.sh

# Make executable
chmod +x bun-linux-x64-sfx.sh

# Run
./bun-linux-x64-sfx.sh
```

### Custom Installation Directory

By default, Bun installs to `$HOME/.bun/bin`. You can override this:

```bash
BUN_INSTALL_DIR=/usr/local/bin ./bun-linux-x64-sfx.sh
```

## How It Works

The self-extracting archives are shell scripts with these components:

1. **Shell Script Header**: A POSIX-compliant shell script that:

   - Checks system compatibility
   - Creates the installation directory
   - Extracts the embedded binary
   - Sets proper permissions
   - Provides PATH setup instructions

2. **Embedded Binary**: The Bun executable is:

   - Compressed with gzip
   - Encoded in base64 for text safety
   - Appended to the shell script

3. **No External Dependencies**: Only uses standard POSIX tools:
   - `sh` (POSIX shell)
   - `tar`, `gzip` (for extraction)
   - `base64` (for decoding)
   - `awk`, `tail` (for payload extraction)

## Advantages

- **No `unzip` Required**: Works on minimal Linux systems
- **Single File**: Everything in one downloadable script
- **Secure**: Checksums provided for verification
- **Portable**: POSIX-compliant, works on most Linux distributions
- **Architecture Detection**: Universal installer automatically selects the right binary

## Verification

Always verify downloads using the provided checksums:

```bash
# Download checksum
curl -LO https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-sfx.sh.sha256

# Verify
sha256sum -c bun-linux-x64-sfx.sh.sha256
```
