#!/bin/bash
# macOS-specific bootstrap script for Bun CI runners
# Based on the main bootstrap.sh but optimized for macOS CI environments

set -euo pipefail

print() {
    echo "$@"
}

error() {
    print "error: $@" >&2
    exit 1
}

execute() {
    print "$ $@" >&2
    if ! "$@"; then
        error "Command failed: $@"
    fi
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    error "This script should not be run as root"
fi

# Check if running on macOS
if [[ "$(uname -s)" != "Darwin" ]]; then
    error "This script is designed for macOS only"
fi

print "Starting macOS bootstrap for Bun CI..."

# Get macOS version
MACOS_VERSION=$(sw_vers -productVersion)
MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)
MACOS_MINOR=$(echo "$MACOS_VERSION" | cut -d. -f2)

print "macOS Version: $MACOS_VERSION"

# Install Xcode Command Line Tools if not already installed
if ! xcode-select -p &>/dev/null; then
    print "Installing Xcode Command Line Tools..."
    xcode-select --install
    # Wait for installation to complete
    until xcode-select -p &>/dev/null; do
        sleep 10
    done
fi

# Install Homebrew if not already installed
if ! command -v brew &>/dev/null; then
    print "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH
    if [[ "$(uname -m)" == "arm64" ]]; then
        echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zprofile
        export PATH="/opt/homebrew/bin:$PATH"
    else
        echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zprofile
        export PATH="/usr/local/bin:$PATH"
    fi
fi

# Configure Homebrew for CI
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ANALYTICS=1

# Update Homebrew
print "Updating Homebrew..."
brew update

# Install essential packages
print "Installing essential packages..."
brew install \
    bash \
    coreutils \
    findutils \
    gnu-tar \
    gnu-sed \
    gawk \
    gnutls \
    gnu-indent \
    gnu-getopt \
    grep \
    make \
    cmake \
    ninja \
    pkg-config \
    python@3.11 \
    python@3.12 \
    go \
    rust \
    node \
    bun \
    git \
    wget \
    curl \
    jq \
    tree \
    htop \
    watch \
    tmux \
    screen \
    gh

# Install Docker Desktop
print "Installing Docker Desktop..."
if [[ ! -d "/Applications/Docker.app" ]]; then
    if [[ "$(uname -m)" == "arm64" ]]; then
        curl -L "https://desktop.docker.com/mac/main/arm64/Docker.dmg" -o /tmp/Docker.dmg
    else
        curl -L "https://desktop.docker.com/mac/main/amd64/Docker.dmg" -o /tmp/Docker.dmg
    fi
    
    hdiutil attach /tmp/Docker.dmg
    cp -R /Volumes/Docker/Docker.app /Applications/
    hdiutil detach /Volumes/Docker
    rm /tmp/Docker.dmg
fi

# Install Buildkite agent
print "Installing Buildkite agent..."
brew install buildkite/buildkite/buildkite-agent

# Create directories for Buildkite
sudo mkdir -p /usr/local/var/buildkite-agent
sudo mkdir -p /usr/local/var/log/buildkite-agent
sudo chown -R "$(whoami):admin" /usr/local/var/buildkite-agent
sudo chown -R "$(whoami):admin" /usr/local/var/log/buildkite-agent

# Install Node.js versions (to match bootstrap.sh)
print "Installing specific Node.js version..."
NODE_VERSION="24.3.0"
if [[ "$(node --version 2>/dev/null || echo '')" != "v$NODE_VERSION" ]]; then
    # Install n (Node.js version manager)
    npm install -g n
    # Install and use specific Node.js version
    n "$NODE_VERSION"
    # Install npm packages globally
    npm install -g npm@latest
fi

# Install Bun specific version (to match bootstrap.sh)
print "Installing specific Bun version..."
BUN_VERSION="1.2.17"
if [[ "$(bun --version 2>/dev/null || echo '')" != "$BUN_VERSION" ]]; then
    curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION"
fi

# Install Rust toolchain
print "Configuring Rust toolchain..."
if command -v rustup &>/dev/null; then
    rustup update
    rustup target add x86_64-apple-darwin
    rustup target add aarch64-apple-darwin
fi

# Install additional development tools
print "Installing additional development tools..."
brew install \
    llvm \
    clang-format \
    ccache \
    ninja \
    meson \
    autoconf \
    automake \
    libtool \
    gettext \
    openssl \
    readline \
    sqlite \
    xz \
    zlib \
    libyaml \
    libffi \
    pkg-config

# Configure system settings
print "Configuring system settings..."

# Disable sleep and screensaver
sudo pmset -a displaysleep 0 sleep 0 disksleep 0
sudo pmset -a womp 1

# Disable automatic updates
sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled -bool false
sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticDownload -bool false
sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates -bool false

# Increase file descriptor limits
echo 'kern.maxfiles=1048576' | sudo tee -a /etc/sysctl.conf
echo 'kern.maxfilesperproc=1048576' | sudo tee -a /etc/sysctl.conf

# Enable core dumps
sudo mkdir -p /cores
sudo chmod 777 /cores
echo 'kern.corefile=/cores/core.%P' | sudo tee -a /etc/sysctl.conf

# Configure shell environment
print "Configuring shell environment..."

# Add Homebrew paths to shell profiles
SHELL_PROFILES=(.zshrc .zprofile .bash_profile .bashrc)
for profile in "${SHELL_PROFILES[@]}"; do
    if [[ -f "$HOME/$profile" ]] || [[ "$1" == "--ci" ]]; then
        if [[ "$(uname -m)" == "arm64" ]]; then
            echo 'export PATH="/opt/homebrew/bin:$PATH"' >> "$HOME/$profile"
        else
            echo 'export PATH="/usr/local/bin:$PATH"' >> "$HOME/$profile"
        fi
        
        # Add other useful paths
        echo 'export PATH="/usr/local/bin/bun-ci:$PATH"' >> "$HOME/$profile"
        echo 'export PATH="/usr/local/sbin:$PATH"' >> "$HOME/$profile"
        
        # Environment variables for CI
        echo 'export HOMEBREW_NO_INSTALL_CLEANUP=1' >> "$HOME/$profile"
        echo 'export HOMEBREW_NO_AUTO_UPDATE=1' >> "$HOME/$profile"
        echo 'export HOMEBREW_NO_ANALYTICS=1' >> "$HOME/$profile"
        echo 'export CI=1' >> "$HOME/$profile"
        echo 'export BUILDKITE=true' >> "$HOME/$profile"
        
        # Development environment variables
        echo 'export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"' >> "$HOME/$profile"
        echo 'export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"' >> "$HOME/$profile"
        
        # Node.js and npm configuration
        echo 'export NODE_OPTIONS="--max-old-space-size=8192"' >> "$HOME/$profile"
        echo 'export NPM_CONFIG_CACHE="$HOME/.npm"' >> "$HOME/$profile"
        
        # Rust configuration
        echo 'export CARGO_HOME="$HOME/.cargo"' >> "$HOME/$profile"
        echo 'export RUSTUP_HOME="$HOME/.rustup"' >> "$HOME/$profile"
        echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> "$HOME/$profile"
        
        # Go configuration
        echo 'export GOPATH="$HOME/go"' >> "$HOME/$profile"
        echo 'export PATH="$GOPATH/bin:$PATH"' >> "$HOME/$profile"
        
        # Python configuration
        echo 'export PYTHONPATH="/usr/local/lib/python3.11/site-packages:/usr/local/lib/python3.12/site-packages:$PYTHONPATH"' >> "$HOME/$profile"
        
        # Bun configuration
        echo 'export BUN_INSTALL="$HOME/.bun"' >> "$HOME/$profile"
        echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> "$HOME/$profile"
        
        # LLVM configuration
        echo 'export PATH="/usr/local/opt/llvm/bin:$PATH"' >> "$HOME/$profile"
        echo 'export LDFLAGS="-L/usr/local/opt/llvm/lib"' >> "$HOME/$profile"
        echo 'export CPPFLAGS="-I/usr/local/opt/llvm/include"' >> "$HOME/$profile"
    fi
done

# Create symbolic links for GNU tools
print "Creating symbolic links for GNU tools..."
GNU_TOOLS=(
    "tar:gtar"
    "sed:gsed"
    "awk:gawk"
    "find:gfind"
    "xargs:gxargs"
    "grep:ggrep"
    "make:gmake"
)

for tool_pair in "${GNU_TOOLS[@]}"; do
    tool_name="${tool_pair%%:*}"
    gnu_name="${tool_pair##*:}"
    
    if command -v "$gnu_name" &>/dev/null; then
        sudo ln -sf "$(which "$gnu_name")" "/usr/local/bin/$tool_name"
    fi
done

# Clean up
print "Cleaning up..."
brew cleanup --prune=all
sudo rm -rf /tmp/* /var/tmp/* || true

print "macOS bootstrap completed successfully!"
print "System is ready for Bun CI workloads."