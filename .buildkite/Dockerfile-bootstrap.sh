#!/usr/bin/env bash
set -euo pipefail

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "error: must run as root"
    exit 1
fi

# Check OS compatibility
if ! command -v dnf &> /dev/null; then
    echo "error: this script requires dnf (RHEL/Fedora/CentOS)"
    exit 1
fi

# Ensure /tmp/agent.mjs, /tmp/Dockerfile are present
if [ ! -f /tmp/agent.mjs ] || [ ! -f /tmp/Dockerfile ]; then
    # Print each missing file
    if [ ! -f /tmp/agent.mjs ]; then
        echo "error: /tmp/agent.mjs is missing"
    fi
    if [ ! -f /tmp/Dockerfile ]; then
        echo "error: /tmp/Dockerfile is missing"
    fi
    exit 1
fi

# Install Docker
dnf update -y
dnf install -y docker

systemctl enable docker
systemctl start docker || {
    echo "error: failed to start Docker"
    exit 1
}

# Create builder
docker buildx create --name builder --driver docker-container --bootstrap --use || {
    echo "error: failed to create Docker buildx builder"
    exit 1
}

# Set up Docker to start on boot
cat << 'EOF' > /etc/systemd/system/buildkite-agent.service
[Unit]
Description=Buildkite Docker Container
After=docker.service network-online.target
Requires=docker.service network-online.target

[Service]
TimeoutStartSec=0
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker stop buildkite
ExecStartPre=-/usr/bin/docker rm buildkite
ExecStart=/usr/bin/docker run \
    --name buildkite \
    --restart=unless-stopped \
    --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /tmp:/tmp \
    buildkite:latest

[Install]
WantedBy=multi-user.target
EOF

echo "Building Buildkite image"

# Clean up any previous build artifacts
rm -rf /tmp/fakebun
mkdir -p /tmp/fakebun/scripts /tmp/fakebun/.buildkite

# Copy required files
cp /tmp/agent.mjs /tmp/fakebun/scripts/ || {
    echo "error: failed to copy agent.mjs"
    exit 1
}
cp /tmp/Dockerfile /tmp/fakebun/.buildkite/Dockerfile || {
    echo "error: failed to copy Dockerfile"
    exit 1
}

cd /tmp/fakebun || {
    echo "error: failed to change directory"
    exit 1
}

# Build the Buildkite image
docker buildx build \
    --platform $(uname -m | sed 's/aarch64/linux\/arm64/;s/x86_64/linux\/amd64/') \
    --tag buildkite:latest \
    --target buildkite \
    -f .buildkite/Dockerfile \
    --load \
    . || {
    echo "error: Docker build failed"
    exit 1
}

# Create container to ensure image is cached in AMI
docker container create \
    --name buildkite \
    --restart=unless-stopped \
    buildkite:latest || {
    echo "error: failed to create buildkite container"
    exit 1
}

# Reload systemd to pick up new service
systemctl daemon-reload

# Enable the service, but don't start it yet
systemctl enable buildkite-agent || {
    echo "error: failed to enable buildkite-agent service"
    exit 1
}

echo "Bootstrap complete"
echo "To start the Buildkite agent, run: "
echo "  systemctl start buildkite-agent"