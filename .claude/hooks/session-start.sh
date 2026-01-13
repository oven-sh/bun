#!/bin/bash
set -euo pipefail

# Only run in Claude Code Remote environment
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Fix /tmp permissions if needed (must be world-writable with sticky bit)
if [ "$(stat -c %a /tmp 2>/dev/null)" != "1777" ]; then
  echo "Fixing /tmp permissions..."
  chmod 1777 /tmp 2>/dev/null || true
fi

# Ensure /usr/local/bin takes precedence for bootstrap-installed tools
export PATH="/usr/local/bin:$PATH"

# Fix Python alternatives if apt_pkg module is missing
if ! /usr/bin/python3 -c "import apt_pkg" 2>/dev/null; then
  echo "Fixing Python alternatives for apt_pkg..."
  if [ -f /usr/bin/python3.12 ]; then
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 2>/dev/null || true
    update-alternatives --set python3 /usr/bin/python3.12 2>/dev/null || true
  fi
fi

echo "Running bootstrap to set up build dependencies..."
./scripts/bootstrap.sh || echo "Bootstrap had some errors, continuing..."

# Set up clang as default compiler if not already done
if [ -f /usr/bin/clang-19 ] && [ ! -L /usr/bin/cc ] || [ "$(readlink /usr/bin/cc 2>/dev/null)" != "/usr/bin/clang" ]; then
  echo "Setting up clang-19 as default compiler..."
  ln -sf /usr/bin/clang-19 /usr/bin/clang 2>/dev/null || true
  ln -sf /usr/bin/clang++-19 /usr/bin/clang++ 2>/dev/null || true
  ln -sf /usr/bin/clang /usr/bin/cc 2>/dev/null || true
  ln -sf /usr/bin/clang++ /usr/bin/c++ 2>/dev/null || true
  ln -sf /usr/bin/lld-19 /usr/bin/lld 2>/dev/null || true
  ln -sf /usr/bin/ld.lld-19 /usr/bin/ld.lld 2>/dev/null || true
  ln -sf /usr/bin/llvm-ar-19 /usr/bin/llvm-ar 2>/dev/null || true
  ln -sf /usr/bin/llvm-symbolizer-19 /usr/bin/llvm-symbolizer 2>/dev/null || true
fi

# Persist environment variables for the session
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="/usr/local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
  echo 'export CC=/usr/bin/clang' >> "$CLAUDE_ENV_FILE"
  echo 'export CXX=/usr/bin/clang++' >> "$CLAUDE_ENV_FILE"
fi

echo "Installing main dependencies..."
bun install

echo "Installing test dependencies..."
bun install --cwd test --ignore-scripts

echo "Building bun-debug..."
bun run build

echo "Session start hook completed successfully."
