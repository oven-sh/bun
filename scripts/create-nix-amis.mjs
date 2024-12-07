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

  // Read the agent.mjs content
  const agentScript = await readFile("scripts/agent.mjs");

  // Read the flake.nix content
  const flakeContent = await readFile("flake.nix");

  // Create user data script
  const userData = `#!/bin/bash
set -euxo pipefail

echo "Setting up environment..."
export DEBIAN_FRONTEND=noninteractive

echo "Installing required packages..."
sudo apt-get update -qq
sudo apt-get install -y curl xz-utils git sudo --no-install-recommends

echo "Installing Nix..."
sh <(curl -L https://nixos.org/nix/install) --daemon

echo "Configuring Nix..."
# Source Nix in this shell
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Enable flakes
sudo mkdir -p /etc/nix
sudo tee /etc/nix/nix.conf > /dev/null << 'EOF'
experimental-features = nix-command flakes
trusted-users = root buildkite-agent
auto-optimise-store = true
EOF

echo "Installing BuildKite agent..."
# Install BuildKite agent
sudo sh -c 'echo deb https://apt.buildkite.com/buildkite-agent stable main > /etc/apt/sources.list.d/buildkite-agent.list'
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 32A37959C2FA5C3C99EFBC32A79206696452D198
sudo apt-get update
sudo apt-get install -y buildkite-agent

echo "Setting up agent.mjs..."
# Copy agent.mjs to the instance
sudo mkdir -p /usr/local/share/bun
sudo tee /usr/local/share/bun/agent.mjs > /dev/null << 'EOF'
${agentScript}
EOF
sudo chmod +x /usr/local/share/bun/agent.mjs

echo "Copying flake.nix to the instance..."
sudo mkdir -p /var/lib/buildkite-agent/bun
sudo tee /var/lib/buildkite-agent/bun/flake.nix > /dev/null << 'EOF'
${flakeContent}
EOF

echo "Setting ownership..."
sudo chown -R buildkite-agent:buildkite-agent /var/lib/buildkite-agent/bun

echo "Setting system limits for buildkite-agent..."
sudo tee /etc/security/limits.d/buildkite-agent.conf > /dev/null << 'EOF'
buildkite-agent soft nofile 1048576
buildkite-agent hard nofile 1048576
buildkite-agent soft nproc 1048576
buildkite-agent hard nproc 1048576
EOF

echo "Setting up Nix environment and installing BuildKite agent..."
cd /var/lib/buildkite-agent/bun
# Initialize flake.lock with proper permissions
sudo -u buildkite-agent sh -c 'cd "$1" && nix flake update' -- /var/lib/buildkite-agent/bun
# Now run the agent in the Nix environment
sudo -u buildkite-agent sh -c 'cd "$1" && nix develop .#ci-${flakeTarget} -c /usr/local/share/bun/agent.mjs install start' -- /var/lib/buildkite-agent/bun`;

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
        "--no-bootstrap",
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
