#!/bin/bash
# Main job runner script that manages the lifecycle of Buildkite jobs
# This script creates users, runs jobs, and cleans up afterward

set -euo pipefail

print() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    print "ERROR: $*" >&2
    exit 1
}

# Ensure running as root
if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root"
fi

# Configuration
BUILDKITE_AGENT_TOKEN="${BUILDKITE_AGENT_TOKEN:-}"
BUILDKITE_QUEUE="${BUILDKITE_QUEUE:-default}"
BUILDKITE_TAGS="${BUILDKITE_TAGS:-queue=$BUILDKITE_QUEUE,os=macos,arch=$(uname -m)}"
LOG_DIR="/usr/local/var/log/buildkite-agent"
AGENT_CONFIG_DIR="/usr/local/var/buildkite-agent"

# Ensure directories exist
mkdir -p "$LOG_DIR"
mkdir -p "$AGENT_CONFIG_DIR"

# Function to cleanup on exit
cleanup() {
    local exit_code=$?
    print "Job runner exiting with code $exit_code"
    
    # Clean up current user if set
    if [[ -n "${CURRENT_USER:-}" ]]; then
        print "Cleaning up user: $CURRENT_USER"
        /usr/local/bin/bun-ci/cleanup-build-user.sh "$CURRENT_USER" || true
    fi
    
    # Kill any remaining buildkite-agent processes
    pkill -f "buildkite-agent" || true
    
    exit $exit_code
}

trap cleanup EXIT INT TERM

# Function to run a single job
run_job() {
    local job_id="$1"
    local user_info
    
    print "Starting job: $job_id"
    
    # Create isolated user for this job
    print "Creating isolated build user..."
    user_info=$(/usr/local/bin/bun-ci/create-build-user.sh)
    
    # Parse user info
    export BK_USER=$(echo "$user_info" | grep "BK_USER=" | cut -d= -f2)
    export BK_HOME=$(echo "$user_info" | grep "BK_HOME=" | cut -d= -f2)
    export BK_WORKSPACE=$(echo "$user_info" | grep "BK_WORKSPACE=" | cut -d= -f2)
    export BK_UID=$(echo "$user_info" | grep "BK_UID=" | cut -d= -f2)
    
    CURRENT_USER="$BK_USER"
    
    print "Job will run as user: $BK_USER"
    print "Workspace: $BK_WORKSPACE"
    
    # Create job-specific configuration
    local job_config="${AGENT_CONFIG_DIR}/buildkite-agent-${job_id}.cfg"
    cat > "$job_config" << EOF
token="${BUILDKITE_AGENT_TOKEN}"
name="macos-$(hostname)-${job_id}"
tags="${BUILDKITE_TAGS}"
build-path="${BK_WORKSPACE}"
hooks-path="/usr/local/bin/bun-ci/hooks"
plugins-path="${BK_HOME}/.buildkite-agent/plugins"
git-clean-flags="-fdq"
git-clone-flags="-v"
shell="/bin/bash -l"
spawn=1
priority=normal
disconnect-after-job=true
disconnect-after-idle-timeout=300
cancel-grace-period=10
enable-job-log-tmpfile=true
job-log-tmpfile-path="/tmp/buildkite-job-${job_id}.log"
timestamp-lines=true
EOF
    
    # Set permissions
    chown "$BK_USER:staff" "$job_config"
    chmod 600 "$job_config"
    
    # Start timeout monitor in background
    (
        sleep "${BUILDKITE_TIMEOUT:-3600}"
        print "Job timeout reached, killing all processes for user $BK_USER"
        pkill -TERM -u "$BK_USER" || true
        sleep 10
        pkill -KILL -u "$BK_USER" || true
    ) &
    local timeout_pid=$!
    
    # Run buildkite-agent as the isolated user
    print "Starting Buildkite agent for job $job_id..."
    
    local agent_exit_code=0
    sudo -u "$BK_USER" -H /usr/local/bin/buildkite-agent start \
        --config "$job_config" \
        --log-level info \
        --no-color \
        2>&1 | tee -a "$LOG_DIR/job-${job_id}.log" || agent_exit_code=$?
    
    # Kill timeout monitor
    kill $timeout_pid 2>/dev/null || true
    
    print "Job $job_id completed with exit code: $agent_exit_code"
    
    # Clean up job-specific files
    rm -f "$job_config"
    rm -f "/tmp/buildkite-job-${job_id}.log"
    
    # Clean up the user
    print "Cleaning up user $BK_USER..."
    /usr/local/bin/bun-ci/cleanup-build-user.sh "$BK_USER" || true
    CURRENT_USER=""
    
    return $agent_exit_code
}

# Function to wait for jobs
wait_for_jobs() {
    print "Waiting for Buildkite jobs..."
    
    # Check for required configuration
    if [[ -z "$BUILDKITE_AGENT_TOKEN" ]]; then
        error "BUILDKITE_AGENT_TOKEN is required"
    fi
    
    # Main loop to handle jobs
    while true; do
        # Generate unique job ID
        local job_id=$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-' | cut -c1-8)
        
        print "Ready to accept job with ID: $job_id"
        
        # Try to run a job
        if ! run_job "$job_id"; then
            print "Job $job_id failed, continuing..."
        fi
        
        # Brief pause before accepting next job
        sleep 5
        
        # Clean up any remaining processes
        print "Performing system cleanup..."
        pkill -f "buildkite-agent" || true
        
        # Clean up temporary files
        find /tmp -name "buildkite-*" -mtime +1 -delete 2>/dev/null || true
        find /var/tmp -name "buildkite-*" -mtime +1 -delete 2>/dev/null || true
        
        # Clean up any orphaned users (safety net)
        for user in $(dscl . list /Users | grep "^bk-"); do
            if [[ -n "$user" ]]; then
                print "Cleaning up orphaned user: $user"
                /usr/local/bin/bun-ci/cleanup-build-user.sh "$user" || true
            fi
        done
        
        # Free up memory
        sync
        purge || true
        
        print "System cleanup completed, ready for next job"
    done
}

# Function to perform health checks
health_check() {
    print "Performing health check..."
    
    # Check disk space
    local disk_usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [[ $disk_usage -gt 90 ]]; then
        error "Disk usage is too high: ${disk_usage}%"
    fi
    
    # Check memory
    local memory_pressure=$(memory_pressure | grep "System-wide memory free percentage" | awk '{print $5}' | sed 's/%//')
    if [[ $memory_pressure -lt 10 ]]; then
        error "Memory pressure is too high: ${memory_pressure}% free"
    fi
    
    # Check if Docker is running
    if ! pgrep -x "Docker" > /dev/null; then
        print "Docker is not running, attempting to start..."
        open -a Docker || true
        sleep 30
    fi
    
    # Check if required commands are available
    local required_commands=("git" "node" "npm" "bun" "python3" "go" "rustc" "cargo" "cmake" "make")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &>/dev/null; then
            error "Required command not found: $cmd"
        fi
    done
    
    print "Health check passed"
}

# Main execution
case "${1:-start}" in
    start)
        print "Starting Buildkite job runner for macOS"
        health_check
        wait_for_jobs
        ;;
    health)
        health_check
        ;;
    cleanup)
        print "Performing manual cleanup..."
        # Clean up any existing users
        for user in $(dscl . list /Users | grep "^bk-"); do
            if [[ -n "$user" ]]; then
                print "Cleaning up user: $user"
                /usr/local/bin/bun-ci/cleanup-build-user.sh "$user" || true
            fi
        done
        print "Manual cleanup completed"
        ;;
    *)
        error "Usage: $0 {start|health|cleanup}"
        ;;
esac