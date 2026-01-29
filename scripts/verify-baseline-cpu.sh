#!/usr/bin/env bash
set -euo pipefail

# Verify that a Bun binary doesn't use CPU instructions beyond its baseline target.
# Uses QEMU user-mode emulation with restricted CPU features.
# Any illegal instruction (SIGILL) causes exit code 132 and fails the build.
#
# QEMU must be pre-installed in the CI image (see .buildkite/Dockerfile and
# scripts/bootstrap.sh).

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
  # cortex-a53 is ARMv8.0-A (no LSE atomics, no SVE). It's the most widely
  # supported ARMv8.0 model across QEMU versions.
  QEMU_CPU="cortex-a53"
else
  echo "ERROR: Unknown arch: $ARCH"
  exit 1
fi

if ! command -v "$QEMU_BIN" &>/dev/null; then
  echo "ERROR: $QEMU_BIN not found. It must be pre-installed in the CI image."
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
  else
    local exit_code=$?
    echo ""
    echo "FAIL: $label (exit code $exit_code)"
    if [ $exit_code -eq 132 ]; then
      echo "FATAL: Illegal instruction (SIGILL) detected during: $label"
      echo "The binary uses CPU instructions not available on $QEMU_CPU."
      if [ "$ARCH" = "x64" ]; then
        echo "The baseline x64 build targets Nehalem (SSE4.2). AVX/AVX2/AVX512 instructions are not allowed."
      else
        echo "The aarch64 build targets Cortex-A53 (ARMv8.0-A+CRC). LSE atomics, SVE, and dotprod are not allowed."
      fi
    fi
    exit $exit_code
  fi
}

run_test "bun --version" "$BINARY" --version
run_test "bun -e eval" "$BINARY" -e "console.log(JSON.stringify({ok:1+1}))"

echo ""
echo "Baseline CPU verification passed for $ARCH ($QEMU_CPU)."
