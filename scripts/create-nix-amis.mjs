#!/usr/bin/env node

import { parseArgs } from "node:util";
import { getBuildNumber, getSecret, isCI, parseArch, spawnSafe, startGroup, readFile, mkdtemp, rm } from "./utils.mjs";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

async function main() {
  const {
    values: { arch, cloud },
  } = parseArgs({
    options: {
      arch: { type: "string" },
      cloud: { type: "string" },
    },
  });

  if (!arch) {
    throw new Error("--arch is required");
  }

  if (!cloud) {
    throw new Error("--cloud is required");
  }

  const architecture = parseArch(arch);
  const flakeTarget = architecture === "arm64" ? "arm64" : "x64";

  // Read the flake.nix content
  const flakeContent = await readFile("flake.nix");

  // Create user data script
  const userData = `#!/bin/bash
set -euo pipefail

echo "Setting up environment..."
export DEBIAN_FRONTEND=noninteractive
echo "export DEBIAN_FRONTEND=noninteractive" >> ~/.bashrc

echo "Installing required packages..."

# Install required packages
apt-get update -qq
apt-get install -y curl xz-utils git sudo --no-install-recommends

echo "Installing Nix..."

# Install Nix
curl -L https://nixos.org/nix/install | sh -s -- --daemon

# Source Nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

echo "Configuring Nix..."

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

echo "Installing BuildKite agent..."

# Install BuildKite agent
sh -c 'echo deb https://apt.buildkite.com/buildkite-agent stable main > /etc/apt/sources.list.d/buildkite-agent.list'
apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 32A37959C2FA5C3C99EFBC32A79206696452D198
apt-get update
apt-get install -y buildkite-agent

echo "Configuring BuildKite agent..."

# Configure BuildKite agent
cat > /etc/buildkite-agent/buildkite-agent.cfg << 'EOF'
token="xxx"
name="%hostname-%n"
tags="queue=linux-nix,arch=${architecture}"
build-path="/var/lib/buildkite-agent/builds"
hooks-path="/etc/buildkite-agent/hooks"
plugins-path="/etc/buildkite-agent/plugins"
EOF

echo "Copying flake.nix to the instance..."
mkdir -p /home/buildkite-agent/bun
cat > /home/buildkite-agent/bun/flake.nix << 'EOF'
${flakeContent}
EOF

echo "Setting ownership..."
chown -R buildkite-agent:buildkite-agent /home/buildkite-agent/bun

echo "Creating BuildKite hook to set up Nix environment..."
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

echo "Setting proper ownership for BuildKite directories..."
chown -R buildkite-agent:buildkite-agent /etc/buildkite-agent /var/lib/buildkite-agent

echo "Setting system limits for buildkite-agent..."
cat > /etc/security/limits.d/buildkite-agent.conf << 'EOF'
buildkite-agent soft nofile 1048576
buildkite-agent hard nofile 1048576
buildkite-agent soft nproc 1048576
buildkite-agent hard nproc 1048576
EOF

echo "Enabling and starting BuildKite agent service..."
systemctl enable buildkite-agent
systemctl start buildkite-agent`;

  // Write user data to a temporary file
  const userDataFile = mkdtemp("user-data-", "user-data.sh");
  await writeFile(userDataFile, userData);

  try {
    // Use machine.mjs to create the AMI with the user data
    await spawnSafe(
      [
        "node",
        "./scripts/machine.mjs",
        "publish-image",
        `--os=linux`,
        `--arch=${architecture}`,
        `--distro=ubuntu`,
        `--release=18.04`,
        `--cloud=${cloud}`,
        `--ci`,
        `--authorized-org=oven-sh`,
        `--user-data=${userDataFile}`,
      ],
      {
        stdio: "inherit",
      },
    );
  } finally {
    // Clean up the temporary file
    await rm(userDataFile);
  }
}

await main();
