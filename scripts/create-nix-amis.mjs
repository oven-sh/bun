#!/usr/bin/env node

import { parseArgs } from "node:util";
import { getBuildNumber, getSecret, isCI, parseArch, spawnSafe, startGroup, readFile } from "./utils.mjs";
import { join } from "node:path";

async function main() {
  const {
    values: { arch, ci },
  } = parseArgs({
    options: {
      arch: { type: "string" },
      ci: { type: "boolean" },
    },
  });

  if (!arch) {
    throw new Error("--arch is required");
  }

  const architecture = parseArch(arch);
  const flakeTarget = architecture === "arm64" ? "arm64" : "x64";

  // Read the flake.nix content
  const flakeContent = await readFile("flake.nix");

  // Create user data script
  const userData = `#!/bin/bash
set -euxo pipefail

# Install required packages
apt-get update
apt-get install -y curl xz-utils git sudo

# Install Nix
curl -L https://nixos.org/nix/install | sh -s -- --daemon

# Source Nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Enable flakes
mkdir -p /etc/nix
cat > /etc/nix/nix.conf << 'EOF'
experimental-features = nix-command flakes
trusted-users = root buildkite-agent
auto-optimise-store = true
EOF

# Create buildkite-agent user and group
useradd -m -s /bin/bash buildkite-agent
usermod -aG sudo buildkite-agent
echo "buildkite-agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/buildkite-agent

# Copy flake.nix to the instance
mkdir -p /home/buildkite-agent/bun
cat > /home/buildkite-agent/bun/flake.nix << 'EOF'
${flakeContent}
EOF

# Set ownership
chown -R buildkite-agent:buildkite-agent /home/buildkite-agent/bun

# Install BuildKite agent
sh -c 'echo deb https://apt.buildkite.com/buildkite-agent stable main > /etc/apt/sources.list.d/buildkite-agent.list'
apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 32A37959C2FA5C3C99EFBC32A79206696452D198
apt-get update
apt-get install -y buildkite-agent

# Configure BuildKite agent
cat > /etc/buildkite-agent/buildkite-agent.cfg << 'EOF'
token="xxx"
name="%hostname-%n"
tags="queue=linux-nix,arch=${architecture}"
build-path="/var/lib/buildkite-agent/builds"
hooks-path="/etc/buildkite-agent/hooks"
plugins-path="/etc/buildkite-agent/plugins"
EOF

# Create BuildKite hook to set up Nix environment
mkdir -p /etc/buildkite-agent/hooks
cat > /etc/buildkite-agent/hooks/environment << 'EOF'
#!/bin/bash
set -euo pipefail

# Source Nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Set up build environment using flake
cd /home/buildkite-agent/bun
nix develop .#ci-${flakeTarget} -c true

# Add Nix to PATH
export PATH="/nix/var/nix/profiles/default/bin:$PATH"
EOF

chmod +x /etc/buildkite-agent/hooks/environment

# Set proper ownership for BuildKite directories
chown -R buildkite-agent:buildkite-agent /etc/buildkite-agent /var/lib/buildkite-agent

# Start BuildKite agent service
systemctl enable buildkite-agent
systemctl start buildkite-agent

# Set system limits for buildkite-agent
cat > /etc/security/limits.d/buildkite-agent.conf << 'EOF'
buildkite-agent soft nofile 1048576
buildkite-agent hard nofile 1048576
buildkite-agent soft nproc 1048576
buildkite-agent hard nproc 1048576
EOF`;

  // Use machine.mjs to create the AMI with the user data
  await spawnSafe([
    "node",
    "./scripts/machine.mjs",
    "publish-image",
    `--os=linux`,
    `--arch=${architecture}`,
    `--distro=ubuntu`,
    `--release=18.04`,
    `--cloud=aws`,
    `--ci`,
    `--authorized-org=oven-sh`,
    `--user-data=${userData}`,
  ]);
}

await main();
