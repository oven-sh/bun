#!/usr/bin/env bash
set -euo pipefail

# Run JSC JIT stress tests under QEMU to verify that JIT-compiled code
# doesn't use CPU instructions beyond the baseline target.
#
# This script exercises all JIT tiers (DFG, FTL, Wasm BBQ/OMG) and catches
# cases where JIT-generated code emits AVX instructions on x64 or LSE
# atomics on aarch64.
#
# See: test/js/bun/jsc-stress/ for the test fixtures.

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

# Convert to absolute path for use after pushd
BINARY="$(cd "$(dirname "$BINARY")" && pwd)/$(basename "$BINARY")"

# Select QEMU binary and CPU model
if [ "$ARCH" = "x64" ]; then
  QEMU_BIN="qemu-x86_64"
  if [ -f "/usr/bin/qemu-x86_64-static" ]; then
    QEMU_BIN="qemu-x86_64-static"
  fi
  QEMU_CPU="Nehalem"
  CPU_DESC="Nehalem (SSE4.2, no AVX/AVX2/AVX512)"
elif [ "$ARCH" = "aarch64" ]; then
  QEMU_BIN="qemu-aarch64"
  if [ -f "/usr/bin/qemu-aarch64-static" ]; then
    QEMU_BIN="qemu-aarch64-static"
  fi
  QEMU_CPU="cortex-a53"
  CPU_DESC="Cortex-A53 (ARMv8.0-A+CRC, no LSE/SVE)"
else
  echo "ERROR: Unknown arch: $ARCH"
  exit 1
fi

if ! command -v "$QEMU_BIN" &>/dev/null; then
  echo "ERROR: $QEMU_BIN not found. It must be pre-installed in the CI image."
  exit 1
fi

BINARY_NAME=$(basename "$BINARY")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES_DIR="$REPO_ROOT/test/js/bun/jsc-stress/fixtures"
WASM_FIXTURES_DIR="$FIXTURES_DIR/wasm"
PRELOAD_PATH="$REPO_ROOT/test/js/bun/jsc-stress/preload.js"

echo "--- Running JSC JIT stress tests on $CPU_DESC"
echo "    Binary: $BINARY"
echo "    QEMU:   $QEMU_BIN -cpu $QEMU_CPU"
echo ""

FAILED=0
PASSED=0

run_fixture() {
  local fixture="$1"
  local fixture_name
  fixture_name=$(basename "$fixture")

  echo "+++ $fixture_name"
  if "$QEMU_BIN" -cpu "$QEMU_CPU" "$BINARY" --preload "$PRELOAD_PATH" "$fixture" 2>&1; then
    echo "    PASS"
    ((PASSED++))
    return 0
  else
    local exit_code=$?
    if [ $exit_code -eq 132 ]; then
      echo "    FAIL: Illegal instruction (SIGILL)"
      echo ""
      echo "    JIT-compiled code in $fixture_name uses CPU instructions not available on $QEMU_CPU."
      if [ "$ARCH" = "x64" ]; then
        echo "    The baseline x64 build targets Nehalem (SSE4.2)."
        echo "    JIT must not emit AVX, AVX2, or AVX512 instructions."
      else
        echo "    The aarch64 build targets Cortex-A53 (ARMv8.0-A+CRC)."
        echo "    JIT must not emit LSE atomics, SVE, or dotprod instructions."
      fi
    else
      echo "    FAIL: exit code $exit_code"
    fi
    ((FAILED++))
    return $exit_code
  fi
}

# Run JS fixtures (DFG/FTL)
echo "--- JS fixtures (DFG/FTL)"
for fixture in "$FIXTURES_DIR"/*.js; do
  if [ -f "$fixture" ]; then
    run_fixture "$fixture" || true
  fi
done

# Run Wasm fixtures (BBQ/OMG)
echo "--- Wasm fixtures (BBQ/OMG)"
for fixture in "$WASM_FIXTURES_DIR"/*.js; do
  if [ -f "$fixture" ]; then
    # Wasm tests need to run from the wasm fixtures directory
    # because they reference .wasm files relative to the script
    pushd "$WASM_FIXTURES_DIR" > /dev/null
    run_fixture "$fixture" || true
    popd > /dev/null
  fi
done

echo ""
echo "--- Summary"
echo "    Passed: $PASSED"
echo "    Failed: $FAILED"
echo ""

if [ $FAILED -gt 0 ]; then
  echo "    Some JIT stress tests failed under QEMU emulation."
  echo "    This indicates JIT-generated code uses unsupported CPU instructions."
  exit 1
fi

echo "    All JIT stress tests passed on $QEMU_CPU."
