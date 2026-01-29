#!/usr/bin/env bash
set -euo pipefail

# Verify that a Bun binary doesn't use CPU instructions beyond its baseline target.
# Uses QEMU user-mode emulation with restricted CPU features.
# Any illegal instruction (SIGILL) causes exit code 132 and fails the build.

ARCH=""
BINARY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --arch) ARCH="$2"; shift 2 ;;
    --binary) BINARY="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [ -z "$ARCH" ] || [ -z "$BINARY" ]; then
  echo "Usage: $0 --arch <x64|aarch64> --binary <path>"
  exit 1
fi

if [ ! -f "$BINARY" ]; then
  echo "ERROR: Binary not found: $BINARY"
  exit 1
fi

# Install QEMU user-mode
echo "--- Installing QEMU user-mode"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
  else
    echo "ERROR: Not root and passwordless sudo not available"
    exit 1
  fi
fi

if command -v apk &>/dev/null; then
  if [ "$ARCH" = "x64" ]; then
    $SUDO apk add --no-cache qemu-x86_64
  else
    $SUDO apk add --no-cache qemu-aarch64
  fi
elif command -v dnf &>/dev/null; then
  $SUDO dnf install -y qemu-user-static
elif command -v apt-get &>/dev/null; then
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq qemu-user-static
else
  echo "ERROR: No supported package manager found (apk/dnf/apt-get)"
  exit 1
fi

# Select QEMU binary and CPU model
HOST_ARCH=$(uname -m)
if [ "$ARCH" = "x64" ]; then
  QEMU_BIN="qemu-x86_64"
  if [ -f "/usr/bin/qemu-x86_64-static" ]; then
    QEMU_BIN="qemu-x86_64-static"
  fi
  QEMU_CPU="Nehalem"
elif [ "$ARCH" = "aarch64" ]; then
  QEMU_BIN="qemu-aarch64"
  if [ -f "/usr/bin/qemu-aarch64-static" ]; then
    QEMU_BIN="qemu-aarch64-static"
  fi
  QEMU_CPU="cortex-a35"
else
  echo "ERROR: Unknown arch: $ARCH"
  exit 1
fi

echo "--- Verifying baseline CPU compatibility"
echo "Binary: $BINARY"
echo "QEMU: $QEMU_BIN -cpu $QEMU_CPU"
echo "Host: $HOST_ARCH"

run_test() {
  local label="$1"
  shift
  echo "+++ Test: $label"
  if "$QEMU_BIN" -cpu "$QEMU_CPU" "$@"; then
    echo "PASS: $label"
    return 0
  fi
  local exit_code=$?
  if [ $exit_code -eq 132 ]; then
    echo ""
    echo "FATAL: Illegal instruction (SIGILL) detected during: $label"
    echo "The binary uses CPU instructions not available on $QEMU_CPU."
    if [ "$ARCH" = "x64" ]; then
      echo "The baseline x64 build targets Nehalem (SSE4.2). AVX/AVX2/AVX512 instructions are not allowed."
    else
      echo "The aarch64 build targets Cortex-A35 (ARMv8.0-A+CRC). LSE atomics, SVE, and dotprod are not allowed."
    fi
  fi
  exit $exit_code
}

run_test "bun --version" "$BINARY" --version
run_test "bun -e eval" "$BINARY" -e "console.log(JSON.stringify({ok:1+1}))"

echo ""
echo "Baseline CPU verification passed for $ARCH ($QEMU_CPU)."
