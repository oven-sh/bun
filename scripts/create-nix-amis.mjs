#!/usr/bin/env node

import { parseArgs } from "node:util";
import { getBuildNumber, getSecret, isCI, parseArch, spawnSafe, startGroup, readFile, mkdtemp, rm } from "./utils.mjs";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

async function main() {
  const {
    values: { arch, cloud, release },
  } = parseArgs({
    options: {
      arch: { type: "string" },
      cloud: { type: "string" },
      release: { type: "string" },
    },
  });

  if (!arch) {
    throw new Error("--arch is required");
  }

  if (!cloud) {
    throw new Error("--cloud is required");
  }

  if (!release) {
    throw new Error("--release is required");
  }

  const architecture = parseArch(arch);
  const flakeTarget = architecture === "arm64" ? "arm64" : "x64";

  // Read the required files
  let agentScript, flakeContent, utilsContent;
  try {
    agentScript = await readFile(join(process.cwd(), "scripts", "agent.mjs"), "utf8");
    flakeContent = await readFile(join(process.cwd(), "flake.nix"), "utf8");
    utilsContent = await readFile(join(process.cwd(), "scripts", "utils.mjs"), "utf8");
    console.log("Successfully read configuration files");
  } catch (error) {
    console.error("Failed to read configuration files:", error);
    throw error;
  }

  // Create user data script
  const userData = `#!/bin/bash
set -euxo pipefail

echo "Setting up environment..."
export DEBIAN_FRONTEND=noninteractive

echo "Installing required packages..."
sudo apt-get update -qq
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y curl xz-utils git sudo nodejs --no-install-recommends

echo "Creating buildkite-agent user..."
sudo useradd -m -d /var/lib/buildkite-agent -s /bin/bash buildkite-agent

echo "Creating required directories..."
sudo mkdir -p /var/lib/buildkite-agent/bun
sudo mkdir -p /var/cache/buildkite-agent
sudo mkdir -p /var/log/buildkite-agent
sudo mkdir -p /usr/local/share/bun
sudo mkdir -p /etc/buildkite-agent/hooks

# Copy the agent.mjs script
sudo tee /usr/local/share/bun/agent.mjs > /dev/null << 'EOF'
${agentScript}
EOF

sudo tee /usr/local/share/bun/utils.mjs > /dev/null << 'EOF'
${utilsContent}
EOF

sudo chmod +x /usr/local/share/bun/agent.mjs

# Copy flake.nix
sudo tee /var/lib/buildkite-agent/bun/flake.nix > /dev/null << 'EOF'
${flakeContent}
EOF

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

# Disable documentation to save space
documentation.enable = false
documentation.doc.enable = false
documentation.man.enable = false
documentation.info.enable = false

# Global profile settings
keep-derivations = true
keep-outputs = true
EOF

# Create systemd service for our agent
sudo tee /etc/systemd/system/buildkite-agent.service > /dev/null << EOF
[Unit]
Description=Buildkite Agent
After=network-online.target nix-daemon.service
Wants=network-online.target nix-daemon.service

[Service]
Type=simple
User=buildkite-agent
Group=buildkite-agent
Environment="HOME=/var/lib/buildkite-agent"
Environment="USER=buildkite-agent"
Environment="PATH=/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin"
Environment="NIX_PATH=/nix/var/nix/profiles/per-user/root/channels"
ExecStart=nix develop /var/lib/buildkite-agent/bun#ci-${flakeTarget} --command bash -c "node /usr/local/share/bun/agent.mjs start"
Restart=always
RestartSec=5
TimeoutStopSec=20

# Set max open files
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

curl -fsSL https://keys.openpgp.org/vks/v1/by-fingerprint/32A37959C2FA5C3C99EFBC32A79206696452D198 | sudo gpg --dearmor -o /usr/share/keyrings/buildkite-agent-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/buildkite-agent-archive-keyring.gpg] https://apt.buildkite.com/buildkite-agent stable main" | sudo tee /etc/apt/sources.list.d/buildkite-agent.list
sudo apt-get update -qq
sudo apt-get install -y buildkite-agent

# Create required directories
sudo mkdir -p /var/lib/buildkite-agent/bun
sudo mkdir -p /var/cache/buildkite-agent
sudo mkdir -p /var/log/buildkite-agent

# Configure buildkite-agent
sudo tee /etc/buildkite-agent/buildkite-agent.cfg > /dev/null << 'EOF'
name="%hostname-%n"
tags="queue=build-linux,os=linux,arch=${architecture}"
build-path=/var/lib/buildkite-agent/builds
hooks-path=/etc/buildkite-agent/hooks
experiment=git-mirrors,normalize-build-paths
debug=true
disconnect-after-job=true
EOF

# Set up hooks
sudo mkdir -p /etc/buildkite-agent/hooks
sudo tee /etc/buildkite-agent/hooks/environment > /dev/null << 'EOF'
#!/bin/bash
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
export PATH="/nix/var/nix/profiles/default/bin:$PATH"
export NIX_PATH="/nix/var/nix/profiles/per-user/root/channels"
EOF

sudo tee /etc/buildkite-agent/hooks/command > /dev/null << 'EOF'
#!/bin/bash
cd "$BUILDKITE_BUILD_DIR"
exec nix develop .#ci-${flakeTarget} --command bash -c "$BUILDKITE_COMMAND"
EOF

sudo chmod +x /etc/buildkite-agent/hooks/*

# Set system limits
sudo tee /etc/security/limits.d/buildkite-agent.conf > /dev/null << 'EOF'
buildkite-agent soft nofile 1048576
buildkite-agent hard nofile 1048576
buildkite-agent soft nproc 1048576
buildkite-agent hard nproc 1048576
EOF

# Set up permissions
sudo chown -R buildkite-agent:buildkite-agent /var/lib/buildkite-agent
sudo chown -R buildkite-agent:buildkite-agent /var/cache/buildkite-agent
sudo chown -R buildkite-agent:buildkite-agent /var/log/buildkite-agent
sudo chown -R buildkite-agent:buildkite-agent /etc/buildkite-agent

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable buildkite-agent

cd /var/lib/buildkite-agent/bun
sudo -u buildkite-agent bash -c "source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh && nix develop .#ci-${flakeTarget} -c echo 'Build environment ready for ${release} - ${architecture}'"
`;

  // Write user data to a temporary file
  const userDataFile = mkdtemp("user-data-", "user-data.sh");
  await writeFile(userDataFile, userData);

  try {
    // Use machine.mjs to create the AMI with the user data
    await spawnSafe(
      [
        "node",
        "./scripts/machine.mjs",
        release,
        "--os=linux",
        `--arch=${architecture}`,
        "--distro=ubuntu",
        // Orbstack requires 20.04+.
        "--release=" + (cloud === "orbstack" ? "20.04" : "18.04"),
        `--cloud=${cloud}`,
        "--ci",
        "--authorized-org=oven-sh",
        `--user-data=${userDataFile}`,
        "--no-bootstrap",
      ],
      {
        stdio: "inherit",
      },
    );
  } finally {
    // Clean up temporary files
    await rm(userDataFile);
  }
}

await main();
