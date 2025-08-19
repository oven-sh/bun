#!/bin/bash
set -euo pipefail

# Script to run secrets tests on Linux with proper keyring setup
# This is intended for CI environments (Ubuntu/Debian)

echo "🔐 Setting up Linux keyring environment for secrets tests..."

# Check if we're on a supported system
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "❌ This script is only for Linux systems"
    exit 1
fi

# Check if required packages are installed
if ! pkg-config --exists libsecret-1 2>/dev/null; then
    echo "📦 Installing required packages..."
    # Only print install commands in CI, don't actually install (permissions)
    if [[ "${CI:-}" == "true" ]] || [[ "${BUILDKITE:-}" == "true" ]]; then
        echo "Please ensure these packages are installed in CI:"
        echo "  apt-get update && apt-get install -y libsecret-1-dev gnome-keyring dbus-x11"
        exit 1
    else
        echo "Installing packages..."
        sudo apt-get update -qq
        sudo apt-get install -y libsecret-1-dev gnome-keyring dbus-x11
    fi
fi

# Function to setup keyring
setup_keyring() {
    echo "🔧 Setting up keyring..."
    
    # Create keyring directory
    mkdir -p ~/.local/share/keyrings
    
    # Create login keyring file
    cat > ~/.local/share/keyrings/login.keyring << 'EOF'
[keyring]
display-name=login
ctime=1609459200
mtime=1609459200
lock-on-idle=false
lock-after=false
EOF
    
    # Set display for headless environment
    export DISPLAY=:99
    
    # Initialize keyring with empty password
    echo -n "" | gnome-keyring-daemon --daemonize --login
    
    echo "✅ Keyring setup complete"
}

# Function to run tests
run_tests() {
    echo "🧪 Running secrets tests..."
    
    # Get the Bun executable path
    BUN_EXE="${BUN_EXE:-$(cd "$(dirname "$0")/.." && pwd)/build/debug/bun-debug}"
    
    if [[ ! -f "$BUN_EXE" ]]; then
        echo "❌ Bun executable not found at: $BUN_EXE"
        echo "Please build Bun first with: bun bd"
        exit 1
    fi
    
    # Run the secrets test
    "$BUN_EXE" test test/js/bun/secrets.test.ts
}

# Main execution
main() {
    # Run everything in a D-Bus session
    if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
        echo "🚌 Starting D-Bus session..."
        exec dbus-run-session -- "$0" "$@"
    fi
    
    # We're now inside a D-Bus session
    setup_keyring
    run_tests
    
    echo "🎉 All secrets tests passed!"
}

# Run main function
main "$@"