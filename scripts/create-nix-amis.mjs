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

# Create required directories
sudo mkdir -p /var/lib/buildkite-agent/bun
sudo mkdir -p /var/cache/buildkite-agent
sudo mkdir -p /var/log/buildkite-agent

# Create a Nix expression for the buildkite service
sudo mkdir -p /etc/buildkite-agent
cat > /etc/buildkite-agent/service.nix << 'NIXEOF'
{ pkgs ? import <nixpkgs> {} }:

let
  buildkite-agent = pkgs.buildkite-agent;
  flakeTarget = if pkgs.stdenv.isAarch64 then "arm64" else "x64";
in {
  systemd.services.buildkite-agent = {
    description = "Buildkite Agent";
    after = [ "nix-daemon.service" "network-online.target" ];
    wants = [ "nix-daemon.service" "network-online.target" ];
    wantedBy = [ "multi-user.target" ];

    environment = {
      HOME = "/var/lib/buildkite-agent";
      USER = "buildkite-agent";
      NIX_PATH = "/nix/var/nix/profiles/per-user/root/channels";
      PATH = "\${pkgs.lib.makeBinPath [ pkgs.bash pkgs.nix pkgs.nodejs_20 ]}";
    };

    serviceConfig = {
      ExecStart = "/usr/local/share/bun/agent.mjs start";
      User = "buildkite-agent";
      Group = "buildkite-agent";
      RestartSec = "5";
      Restart = "always";
      TimeoutStopSec = "20";
    };
  };

  users.users.buildkite-agent = {
    isSystemUser = true;
    group = "buildkite-agent";
    home = "/var/lib/buildkite-agent";
    createHome = true;
  };

  users.groups.buildkite-agent = {};
}
NIXEOF

# Install and configure buildkite-agent using Nix
nix-env -if /etc/buildkite-agent/service.nix

# Configure buildkite-agent
cat > /etc/buildkite-agent/buildkite-agent.cfg << 'EOF'
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
cat > /etc/buildkite-agent/hooks/environment << 'EOF'
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

# Copy flake.nix
sudo tee /var/lib/buildkite-agent/bun/flake.nix > /dev/null << 'EOF'
${flakeContent}
EOF

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
        "create-image",
        "--os=linux",
        `--arch=${architecture}`,
        "--distro=ubuntu",
        "--release=18.04",
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
