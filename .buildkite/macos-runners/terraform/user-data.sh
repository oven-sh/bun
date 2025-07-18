#!/bin/bash
# User data script for macOS VM initialization
# This script runs when the VM starts up

set -euo pipefail

# Variables passed from Terraform
BUILDKITE_AGENT_TOKEN="${buildkite_agent_token}"
GITHUB_TOKEN="${github_token}"
MACOS_VERSION="${macos_version}"
VM_NAME="${vm_name}"

# Logging
LOG_FILE="/var/log/vm-init.log"
exec 1> >(tee -a "$LOG_FILE")
exec 2> >(tee -a "$LOG_FILE" >&2)

print() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

print "Starting VM initialization for $VM_NAME (macOS $MACOS_VERSION)"

# Wait for system to be ready
print "Waiting for system to be ready..."
until ping -c1 google.com &>/dev/null; do
    sleep 10
done

# Set timezone
print "Setting timezone to UTC..."
sudo systemsetup -settimezone UTC

# Configure hostname
print "Setting hostname to $VM_NAME..."
sudo scutil --set HostName "$VM_NAME"
sudo scutil --set LocalHostName "$VM_NAME"
sudo scutil --set ComputerName "$VM_NAME"

# Update system
print "Checking for system updates..."
sudo softwareupdate -i -a --no-scan || true

# Configure Buildkite agent
print "Configuring Buildkite agent..."
mkdir -p /usr/local/var/buildkite-agent
mkdir -p /usr/local/var/log/buildkite-agent

# Create Buildkite agent configuration
cat > /usr/local/var/buildkite-agent/buildkite-agent.cfg << EOF
token="$BUILDKITE_AGENT_TOKEN"
name="$VM_NAME"
tags="queue=macos,os=macos,arch=$(uname -m),version=$MACOS_VERSION,hostname=$VM_NAME"
build-path="/Users/buildkite/workspace"
hooks-path="/usr/local/bin/bun-ci/hooks"
plugins-path="/Users/buildkite/.buildkite-agent/plugins"
git-clean-flags="-fdq"
git-clone-flags="-v"
shell="/bin/bash -l"
spawn=1
priority=normal
disconnect-after-job=false
disconnect-after-idle-timeout=0
cancel-grace-period=10
enable-job-log-tmpfile=true
timestamp-lines=true
EOF

# Set up GitHub token for private repositories
print "Configuring GitHub access..."
if [[ -n "$GITHUB_TOKEN" ]]; then
    # Configure git to use the token
    git config --global url."https://oauth2:$GITHUB_TOKEN@github.com/".insteadOf "https://github.com/"
    git config --global url."https://oauth2:$GITHUB_TOKEN@github.com/".insteadOf "git@github.com:"
    
    # Configure npm to use the token
    npm config set @oven-sh:registry https://npm.pkg.github.com/
    echo "//npm.pkg.github.com/:_authToken=$GITHUB_TOKEN" >> ~/.npmrc
fi

# Set up SSH keys for GitHub (if available)
if [[ -f "/usr/local/etc/ssh/github_rsa" ]]; then
    print "Configuring SSH keys for GitHub..."
    mkdir -p ~/.ssh
    cp /usr/local/etc/ssh/github_rsa ~/.ssh/
    cp /usr/local/etc/ssh/github_rsa.pub ~/.ssh/
    chmod 600 ~/.ssh/github_rsa
    chmod 644 ~/.ssh/github_rsa.pub
    
    # Configure SSH to use the key
    cat > ~/.ssh/config << EOF
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_rsa
    StrictHostKeyChecking no
EOF
fi

# Create health check endpoint
print "Setting up health check endpoint..."
cat > /usr/local/bin/health-check.sh << 'EOF'
#!/bin/bash
# Health check script for load balancer

set -euo pipefail

# Check if system is ready
if ! ping -c1 google.com &>/dev/null; then
    echo "Network not ready"
    exit 1
fi

# Check disk space
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [[ $DISK_USAGE -gt 95 ]]; then
    echo "Disk usage too high: ${DISK_USAGE}%"
    exit 1
fi

# Check memory
MEMORY_PRESSURE=$(memory_pressure | grep "System-wide memory free percentage" | awk '{print $5}' | sed 's/%//')
if [[ $MEMORY_PRESSURE -lt 5 ]]; then
    echo "Memory pressure too high: ${MEMORY_PRESSURE}% free"
    exit 1
fi

# Check if required services are running
if ! pgrep -f "job-runner.sh" > /dev/null; then
    echo "Job runner not running"
    exit 1
fi

echo "OK"
exit 0
EOF

chmod +x /usr/local/bin/health-check.sh

# Start simple HTTP server for health checks
print "Starting health check server..."
cat > /usr/local/bin/health-server.sh << 'EOF'
#!/bin/bash
# Simple HTTP server for health checks

PORT=8080
while true; do
    echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n$(/usr/local/bin/health-check.sh)" | nc -l -p $PORT
done
EOF

chmod +x /usr/local/bin/health-server.sh

# Create LaunchDaemon for health check server
cat > /Library/LaunchDaemons/com.bun.health-server.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bun.health-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/health-server.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/health-server.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/health-server.error.log</string>
</dict>
</plist>
EOF

# Load and start the health check server
sudo launchctl load /Library/LaunchDaemons/com.bun.health-server.plist
sudo launchctl start com.bun.health-server

# Configure log rotation
print "Configuring log rotation..."
cat > /etc/newsyslog.d/bun-ci.conf << 'EOF'
# Log rotation for Bun CI
/usr/local/var/log/buildkite-agent/*.log    644  5     1000  *     GZ
/var/log/vm-init.log                       644  5     1000  *     GZ
/var/log/health-server.log                 644  5     1000  *     GZ
/var/log/health-server.error.log           644  5     1000  *     GZ
EOF

# Restart syslog to pick up new configuration
sudo launchctl unload /System/Library/LaunchDaemons/com.apple.syslogd.plist
sudo launchctl load /System/Library/LaunchDaemons/com.apple.syslogd.plist

# Configure system monitoring
print "Setting up system monitoring..."
cat > /usr/local/bin/system-monitor.sh << 'EOF'
#!/bin/bash
# System monitoring script

LOG_FILE="/var/log/system-monitor.log"

while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] System Stats:" >> "$LOG_FILE"
    echo "  CPU: $(top -l 1 -n 0 | grep "CPU usage" | awk '{print $3}' | sed 's/%//')" >> "$LOG_FILE"
    echo "  Memory: $(memory_pressure | grep "System-wide memory free percentage" | awk '{print $5}')" >> "$LOG_FILE"
    echo "  Disk: $(df -h / | awk 'NR==2 {print $5}')" >> "$LOG_FILE"
    echo "  Load: $(uptime | awk -F'load averages:' '{print $2}')" >> "$LOG_FILE"
    echo "  Processes: $(ps aux | wc -l)" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"
    
    sleep 300  # 5 minutes
done
EOF

chmod +x /usr/local/bin/system-monitor.sh

# Create LaunchDaemon for system monitoring
cat > /Library/LaunchDaemons/com.bun.system-monitor.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bun.system-monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/system-monitor.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

# Load and start the system monitor
sudo launchctl load /Library/LaunchDaemons/com.bun.system-monitor.plist
sudo launchctl start com.bun.system-monitor

# Final configuration
print "Performing final configuration..."

# Ensure all services are running
sudo launchctl load /Library/LaunchDaemons/com.buildkite.buildkite-agent.plist
sudo launchctl start com.buildkite.buildkite-agent

# Create marker file to indicate initialization is complete
touch /var/tmp/vm-init-complete
echo "$(date '+%Y-%m-%d %H:%M:%S'): VM initialization completed" >> /var/tmp/vm-init-complete

print "VM initialization completed successfully!"
print "VM Name: $VM_NAME"
print "macOS Version: $MACOS_VERSION"
print "Status: Ready for Buildkite jobs"

# Log final system state
print "Final system state:"
print "  Hostname: $(hostname)"
print "  Uptime: $(uptime)"
print "  Disk usage: $(df -h / | awk 'NR==2 {print $5}')"
print "  Memory: $(memory_pressure | grep "System-wide memory free percentage" | awk '{print $5}')"

print "Health check available at: http://$(hostname):8080/health"