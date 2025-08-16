#!/bin/bash
# Create isolated build user for each Buildkite job
# This ensures complete isolation between jobs

set -euo pipefail

print() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    print "ERROR: $*" >&2
    exit 1
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root"
fi

# Generate unique user name
JOB_ID="${BUILDKITE_JOB_ID:-$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-' | cut -c1-8)}"
USERNAME="bk-${JOB_ID}"
USER_HOME="/Users/${USERNAME}"

print "Creating build user: ${USERNAME}"

# Check if user already exists
if id "${USERNAME}" &>/dev/null; then
    print "User ${USERNAME} already exists, cleaning up first..."
    /usr/local/bin/bun-ci/cleanup-build-user.sh "${USERNAME}"
fi

# Find next available UID (starting from 1000)
NEXT_UID=1000
while id -u "${NEXT_UID}" &>/dev/null; do
    ((NEXT_UID++))
done

print "Using UID: ${NEXT_UID}"

# Create user account
dscl . create "/Users/${USERNAME}"
dscl . create "/Users/${USERNAME}" UserShell /bin/bash
dscl . create "/Users/${USERNAME}" RealName "Buildkite Job ${JOB_ID}"
dscl . create "/Users/${USERNAME}" UniqueID "${NEXT_UID}"
dscl . create "/Users/${USERNAME}" PrimaryGroupID 20  # staff group
dscl . create "/Users/${USERNAME}" NFSHomeDirectory "${USER_HOME}"

# Set password (random, but user won't need to login interactively)
RANDOM_PASSWORD=$(openssl rand -base64 32)
dscl . passwd "/Users/${USERNAME}" "${RANDOM_PASSWORD}"

# Create home directory
mkdir -p "${USER_HOME}"
chown "${USERNAME}:staff" "${USER_HOME}"
chmod 755 "${USER_HOME}"

# Copy skeleton files
cp -R /System/Library/User\ Template/English.lproj/. "${USER_HOME}/"
chown -R "${USERNAME}:staff" "${USER_HOME}"

# Set up shell environment
cat > "${USER_HOME}/.zshrc" << 'EOF'
# Buildkite job environment
export PATH="/usr/local/bin:/usr/local/sbin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ANALYTICS=1
export CI=1
export BUILDKITE=true

# Development environment
export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"

# Node.js and npm
export NODE_OPTIONS="--max-old-space-size=8192"
export NPM_CONFIG_CACHE="$HOME/.npm"

# Rust
export CARGO_HOME="$HOME/.cargo"
export RUSTUP_HOME="$HOME/.rustup"
export PATH="$HOME/.cargo/bin:$PATH"

# Go
export GOPATH="$HOME/go"
export PATH="$GOPATH/bin:$PATH"

# Python
export PYTHONPATH="/usr/local/lib/python3.11/site-packages:/usr/local/lib/python3.12/site-packages:$PYTHONPATH"

# Bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# LLVM
export PATH="/usr/local/opt/llvm/bin:$PATH"
export LDFLAGS="-L/usr/local/opt/llvm/lib"
export CPPFLAGS="-I/usr/local/opt/llvm/include"

# Job isolation
export TMPDIR="$HOME/tmp"
export TEMP="$HOME/tmp"
export TMP="$HOME/tmp"
mkdir -p "$TMPDIR"
EOF

# Copy .zshrc to other shell profiles
cp "${USER_HOME}/.zshrc" "${USER_HOME}/.bash_profile"
cp "${USER_HOME}/.zshrc" "${USER_HOME}/.bashrc"

# Create necessary directories
mkdir -p "${USER_HOME}/tmp"
mkdir -p "${USER_HOME}/.npm"
mkdir -p "${USER_HOME}/.cargo"
mkdir -p "${USER_HOME}/.rustup"
mkdir -p "${USER_HOME}/go"
mkdir -p "${USER_HOME}/.bun"

# Set ownership
chown -R "${USERNAME}:staff" "${USER_HOME}"

# Create workspace directory
WORKSPACE_DIR="${USER_HOME}/workspace"
mkdir -p "${WORKSPACE_DIR}"
chown "${USERNAME}:staff" "${WORKSPACE_DIR}"

# Add user to necessary groups
dscl . append /Groups/admin GroupMembership "${USERNAME}"
dscl . append /Groups/wheel GroupMembership "${USERNAME}"
dscl . append /Groups/_developer GroupMembership "${USERNAME}"

# Set up sudo access (for this user only during the job)
cat > "/etc/sudoers.d/${USERNAME}" << EOF
${USERNAME} ALL=(ALL) NOPASSWD: ALL
EOF

# Create job timeout script
cat > "${USER_HOME}/job-timeout.sh" << 'EOF'
#!/bin/bash
# Kill all processes after job timeout
sleep ${BUILDKITE_TIMEOUT:-3600}
pkill -u "${USERNAME}" || true
EOF

chmod +x "${USER_HOME}/job-timeout.sh"
chown "${USERNAME}:staff" "${USER_HOME}/job-timeout.sh"

print "Build user ${USERNAME} created successfully"
print "Home directory: ${USER_HOME}"
print "Workspace directory: ${WORKSPACE_DIR}"

# Output user info for the calling script
echo "BK_USER=${USERNAME}"
echo "BK_HOME=${USER_HOME}"
echo "BK_WORKSPACE=${WORKSPACE_DIR}"
echo "BK_UID=${NEXT_UID}"