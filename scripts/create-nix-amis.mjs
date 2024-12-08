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
  let agentScript, flakeContent, utilsContent;
  try {
    agentScript = await readFile(join(process.cwd(), "scripts", "agent.mjs"), "utf8");
    console.log("Successfully read agent.mjs");
  } catch (error) {
    console.error("Failed to read agent.mjs:", error);
    throw error;
  }

  // Read the flake.nix content
  try {
    flakeContent = await readFile(join(process.cwd(), "flake.nix"), "utf8");
    console.log("Successfully read flake.nix");
  } catch (error) {
    console.error("Failed to read flake.nix:", error);
    throw error;
  }

  // Read the utils.mjs content
  try {
    utilsContent = await readFile(join(process.cwd(), "scripts", "utils.mjs"), "utf8");
    console.log("Successfully read utils.mjs");
  } catch (error) {
    console.error("Failed to read utils.mjs:", error);
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

echo "Installing BuildKite agent..."
# Install BuildKite agent
sudo sh -c 'echo deb https://apt.buildkite.com/buildkite-agent stable main > /etc/apt/sources.list.d/buildkite-agent.list'
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 32A37959C2FA5C3C99EFBC32A79206696452D198
sudo apt-get update
sudo apt-get install -y buildkite-agent

# Create required directories with correct permissions
echo "Setting up directories..."
sudo mkdir -p /usr/local/share/bun
sudo mkdir -p /var/lib/buildkite-agent/bun
sudo mkdir -p /var/cache/buildkite-agent
sudo mkdir -p /var/log/buildkite-agent
sudo mkdir -p /etc/buildkite-agent/hooks

# Set correct ownership
sudo chown -R buildkite-agent:buildkite-agent /var/lib/buildkite-agent
sudo chown -R buildkite-agent:buildkite-agent /var/cache/buildkite-agent
sudo chown -R buildkite-agent:buildkite-agent /var/log/buildkite-agent
sudo chown -R buildkite-agent:buildkite-agent /etc/buildkite-agent
sudo chown -R buildkite-agent:buildkite-agent /usr/local/share/bun

echo "Writing agent.mjs and utils.mjs..."
sudo -u buildkite-agent tee /usr/local/share/bun/agent.mjs > /dev/null << 'EOF'
${agentScript}
EOF
sudo -u buildkite-agent tee /usr/local/share/bun/utils.mjs > /dev/null << 'EOF'
${utilsContent}
EOF

sudo chmod +x /usr/local/share/bun/agent.mjs

echo "Copying flake.nix..."
sudo -u buildkite-agent tee /var/lib/buildkite-agent/bun/flake.nix > /dev/null << 'EOF'
${flakeContent}
EOF

echo "Setting system limits..."
sudo tee /etc/security/limits.d/buildkite-agent.conf > /dev/null << 'EOF'
buildkite-agent soft nofile 1048576
buildkite-agent hard nofile 1048576
buildkite-agent soft nproc 1048576
buildkite-agent hard nproc 1048576
EOF

echo "Setting up Nix environment..."
sudo -i -u buildkite-agent bash << EOF
set -euxo pipefail
cd /var/lib/buildkite-agent/bun

# Source Nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Update flake lock and evaluate the environment
nix flake update
nix develop .#ci-${flakeTarget} -c true

# Create a marker to indicate environment is ready
touch .nix-env-ready
EOF

echo "Setting up hooks..."
sudo -u buildkite-agent tee /etc/buildkite-agent/hooks/command > /dev/null << 'EOF'
#!/bin/bash
set -euo pipefail

# Source Nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Change to the build directory
cd "\$BUILDKITE_BUILD_DIR"

# Use Nix to evaluate and run the command in the proper environment
nix develop .#ci-${flakeTarget} -c eval "\$BUILDKITE_COMMAND"
EOF
sudo chmod +x /etc/buildkite-agent/hooks/command

sudo -u buildkite-agent tee /etc/buildkite-agent/hooks/environment > /dev/null << 'EOF'
#!/bin/bash
set -euo pipefail

# Source Nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Add Nix to PATH
export PATH="/nix/var/nix/profiles/default/bin:\$PATH"
EOF
sudo chmod +x /etc/buildkite-agent/hooks/environment

echo "Installing BuildKite agent service..."
if [ -f "/usr/local/share/bun/agent.mjs" ]; then
  echo "Found agent.mjs, executing..."
  # First run nix-shell as buildkite-agent to get the environment
  sudo -i -u buildkite-agent bash << 'ENVSETUP'
    set -euxo pipefail
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
    cd /var/lib/buildkite-agent/bun
    # Instead of running install directly, create a wrapped command that we'll run as root
    nix develop .#ci-${flakeTarget} -c bash -c 'echo "#!/bin/bash\nset -euxo pipefail\n\nexport PATH=\"\$PATH\"" > /tmp/agent-install.sh'
    nix develop .#ci-${flakeTarget} -c bash -c 'echo "export NODE_PATH=\"\$NODE_PATH\"" >> /tmp/agent-install.sh'
    nix develop .#ci-${flakeTarget} -c bash -c 'echo "node /usr/local/share/bun/agent.mjs install" >> /tmp/agent-install.sh'
    chmod +x /tmp/agent-install.sh
ENVSETUP

  # Now run the wrapped command as root to handle systemd installation
  sudo bash /tmp/agent-install.sh
  rm /tmp/agent-install.sh

  # Start the agent as the buildkite-agent user
  sudo -i -u buildkite-agent bash << EOF
    set -euxo pipefail
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
    cd /var/lib/buildkite-agent/bun
    nix develop .#ci-${flakeTarget} -c node /usr/local/share/bun/agent.mjs start
EOF
else
  echo "ERROR: agent.mjs not found at /usr/local/share/bun/agent.mjs"
  ls -la /usr/local/share/bun/
  exit 1
fi`;

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
