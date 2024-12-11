#!/usr/bin/env bash
set -euo pipefail

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
systemctl start docker

# Create builder
docker buildx create --name builder --driver docker-container --bootstrap --use

# Set up Docker to start on boot
cat << 'EOF' > /etc/systemd/system/buildkite-agent.service
[Unit]
Description=Buildkite Docker Container
After=docker.service
Requires=docker.service

[Service]
TimeoutStartSec=0
Restart=always
ExecStartPre=-/usr/bin/docker stop buildkite
ExecStartPre=-/usr/bin/docker rm buildkite
ExecStart=/usr/bin/docker run \
    --name buildkite \
    --restart=unless-stopped \
    buildkite:latest

[Install]
WantedBy=multi-user.target

EOF

echo "Building Buildkite image"

# Make the directory match up with the Dockerfile
mkdir -p /tmp/fakebun/scripts /tmp/fakebun/.buildkite
cp /tmp/agent.mjs /tmp/fakebun/scripts/
cp /tmp/Dockerfile /tmp/fakebun/.buildkite/Dockerfile

cd /tmp/fakebun

# Build the Buildkite image
docker buildx build \
    --platform $(uname -m | sed 's/aarch64/linux\/arm64/;s/x86_64/linux\/amd64/') \
    --tag buildkite:latest \
    --target buildkite \
    -f .buildkite/Dockerfile \
    .

# Enable the service, but don't start it yet
systemctl enable buildkite-agent

echo "Bootstrap complete"
echo "To start the Buildkite agent, run: "
echo "  systemctl start buildkite-agent"