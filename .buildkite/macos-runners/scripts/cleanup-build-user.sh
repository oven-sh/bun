#!/bin/bash
# Clean up build user and all associated processes/files
# This ensures complete cleanup after each job

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

USERNAME="${1:-}"
if [[ -z "$USERNAME" ]]; then
    error "Usage: $0 <username>"
fi

print "Cleaning up build user: ${USERNAME}"

# Check if user exists
if ! id "${USERNAME}" &>/dev/null; then
    print "User ${USERNAME} does not exist, nothing to clean up"
    exit 0
fi

USER_HOME="/Users/${USERNAME}"

# Stop any background timeout processes
pkill -f "job-timeout.sh" || true

# Kill all processes owned by the user
print "Killing all processes owned by ${USERNAME}..."
pkill -TERM -u "${USERNAME}" || true
sleep 2
pkill -KILL -u "${USERNAME}" || true

# Wait for processes to be cleaned up
sleep 1

# Remove from groups
dscl . delete /Groups/admin GroupMembership "${USERNAME}" 2>/dev/null || true
dscl . delete /Groups/wheel GroupMembership "${USERNAME}" 2>/dev/null || true
dscl . delete /Groups/_developer GroupMembership "${USERNAME}" 2>/dev/null || true

# Remove sudo access
rm -f "/etc/sudoers.d/${USERNAME}"

# Clean up temporary files and caches
print "Cleaning up temporary files..."
if [[ -d "${USER_HOME}" ]]; then
    # Clean up known cache directories
    rm -rf "${USER_HOME}/.npm/_cacache" || true
    rm -rf "${USER_HOME}/.npm/_logs" || true
    rm -rf "${USER_HOME}/.cargo/registry" || true
    rm -rf "${USER_HOME}/.cargo/git" || true
    rm -rf "${USER_HOME}/.rustup/tmp" || true
    rm -rf "${USER_HOME}/.cache" || true
    rm -rf "${USER_HOME}/Library/Caches" || true
    rm -rf "${USER_HOME}/Library/Logs" || true
    rm -rf "${USER_HOME}/Library/Application Support/Crash Reports" || true
    rm -rf "${USER_HOME}/tmp" || true
    rm -rf "${USER_HOME}/.bun/install/cache" || true
    
    # Clean up workspace
    rm -rf "${USER_HOME}/workspace" || true
    
    # Clean up any Docker containers/images created by this user
    if command -v docker &>/dev/null; then
        docker ps -a --filter "label=bk_user=${USERNAME}" -q | xargs -r docker rm -f || true
        docker images --filter "label=bk_user=${USERNAME}" -q | xargs -r docker rmi -f || true
    fi
fi

# Clean up system-wide temporary files related to this user
rm -rf "/tmp/${USERNAME}-"* || true
rm -rf "/var/tmp/${USERNAME}-"* || true

# Clean up any core dumps
rm -f "/cores/core.${USERNAME}."* || true

# Clean up any launchd jobs
launchctl list | grep -E "^[0-9].*${USERNAME}" | awk '{print $3}' | xargs -I {} launchctl remove {} || true

# Remove user account
print "Removing user account..."
dscl . delete "/Users/${USERNAME}"

# Remove home directory
print "Removing home directory..."
if [[ -d "${USER_HOME}" ]]; then
    rm -rf "${USER_HOME}"
fi

# Clean up any remaining processes that might have been missed
print "Final process cleanup..."
ps aux | grep -E "^${USERNAME}\s" | awk '{print $2}' | xargs -r kill -9 || true

# Clean up shared memory segments
ipcs -m | grep "${USERNAME}" | awk '{print $2}' | xargs -r ipcrm -m || true

# Clean up semaphores
ipcs -s | grep "${USERNAME}" | awk '{print $2}' | xargs -r ipcrm -s || true

# Clean up message queues
ipcs -q | grep "${USERNAME}" | awk '{print $2}' | xargs -r ipcrm -q || true

# Clean up any remaining files owned by the user
print "Cleaning up remaining files..."
find /tmp -user "${USERNAME}" -exec rm -rf {} + 2>/dev/null || true
find /var/tmp -user "${USERNAME}" -exec rm -rf {} + 2>/dev/null || true

# Clean up any network interfaces or ports that might be held
lsof -t -u "${USERNAME}" 2>/dev/null | xargs -r kill -9 || true

# Clean up any mount points
mount | grep "${USERNAME}" | awk '{print $3}' | xargs -r umount || true

# Verify cleanup
if id "${USERNAME}" &>/dev/null; then
    error "Failed to remove user ${USERNAME}"
fi

if [[ -d "${USER_HOME}" ]]; then
    error "Failed to remove home directory ${USER_HOME}"
fi

print "Build user ${USERNAME} cleaned up successfully"

# Free up memory
sync
purge || true

print "Cleanup completed"