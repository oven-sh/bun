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

echo "Configuring BuildKite agent..."
# Configure BuildKite agent
sudo tee /etc/buildkite-agent/buildkite-agent.cfg > /dev/null << 'EOF'
token="xxx"
name="%hostname-%n"
tags="queue=linux-nix,arch=${architecture}"
build-path="/var/lib/buildkite-agent/builds"
hooks-path="/etc/buildkite-agent/hooks"
plugins-path="/etc/buildkite-agent/plugins"
debug=true
disconnect-after-job=false
health-check-addr=0.0.0.0:8080
git-clean-flags="-ffdq"
git-clone-flags="-v --recursive"
experiment="git-mirrors"
meta-data-ec2-tags=true
no-command-eval=true
EOF

# Create SSH directory for buildkite-agent
sudo mkdir -p /var/lib/buildkite-agent/.ssh
sudo chmod 700 /var/lib/buildkite-agent/.ssh

# Set up known hosts
sudo tee /var/lib/buildkite-agent/.ssh/known_hosts > /dev/null << 'EOF'
github.com ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==
EOF

# Set proper ownership
sudo chown -R buildkite-agent:buildkite-agent /var/lib/buildkite-agent/.ssh
sudo chmod 600 /var/lib/buildkite-agent/.ssh/known_hosts

echo "Setting up build environment..."
# Create build directory with proper permissions
sudo mkdir -p /var/lib/buildkite-agent/builds
sudo chown -R buildkite-agent:buildkite-agent /var/lib/buildkite-agent/builds
sudo chmod 755 /var/lib/buildkite-agent/builds

# Set up the command hook to use Nix for command evaluation
sudo tee /etc/buildkite-agent/hooks/command > /dev/null << 'EOF'
#!/bin/bash
set -euo pipefail

# Source Nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Change to the build directory
cd "$BUILDKITE_BUILD_DIR"

# Use Nix to evaluate and run the command in the proper environment
nix develop .#ci-${flakeTarget} -c eval "$BUILDKITE_COMMAND"
EOF

sudo chmod +x /etc/buildkite-agent/hooks/command

# Set up the environment hook
sudo tee /etc/buildkite-agent/hooks/environment > /dev/null << 'EOF'
#!/bin/bash
set -euo pipefail

# Source Nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Add Nix to PATH
export PATH="/nix/var/nix/profiles/default/bin:$PATH"

# Set build environment variables
export BUILDKITE_BUILD_PATH="/var/lib/buildkite-agent/builds"
export BUILDKITE_HOOKS_PATH="/etc/buildkite-agent/hooks"
export BUILDKITE_PLUGINS_PATH="/etc/buildkite-agent/plugins"
EOF

sudo chmod +x /etc/buildkite-agent/hooks/environment

echo "Copying flake.nix to the instance..."
sudo mkdir -p /home/buildkite-agent/bun
sudo tee /home/buildkite-agent/bun/flake.nix > /dev/null << 'EOF'
${flakeContent}
EOF

echo "Setting ownership..."
sudo chown -R buildkite-agent:buildkite-agent /home/buildkite-agent/bun

echo "Creating BuildKite hook to set up Nix environment..."
sudo mkdir -p /etc/buildkite-agent/hooks
sudo tee /etc/buildkite-agent/hooks/environment > /dev/null << 'EOF'
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

sudo chmod +x /etc/buildkite-agent/hooks/environment

echo "Setting proper ownership for BuildKite directories..."
sudo chown -R buildkite-agent:buildkite-agent /etc/buildkite-agent /var/lib/buildkite-agent

echo "Setting system limits for buildkite-agent..."
sudo tee /etc/security/limits.d/buildkite-agent.conf > /dev/null << 'EOF'
buildkite-agent soft nofile 1048576
buildkite-agent hard nofile 1048576
buildkite-agent soft nproc 1048576
buildkite-agent hard nproc 1048576
EOF

echo "Enabling and starting BuildKite agent service..."
sudo systemctl enable buildkite-agent
sudo systemctl start buildkite-agent`;

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
