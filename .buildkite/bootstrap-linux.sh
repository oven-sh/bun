#! /bin/bash
# Script to bootstrap a Linux environment for CI.

# Check if sudo privileges are available
if [ "$EUID" -ne 0 ]; then
  echo "This script must be run using sudo."
  exit 1
fi

# Pin versions for some dependencies
LLVM_VERSION=16
NODE_VERSION=22
PNPM_VERSION=9
BUN_VERSION=1.1.8

# Install dependencies
apt-get update
apt-get install -y \
  ca-certificates \
  apt-transport-https \
  dirmngr \
  gnupg \
  curl

# Add repositories
echo "deb https://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-${LLVM_VERSION} main" > /etc/apt/sources.list.d/llvm.list
echo "deb-src https://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-${LLVM_VERSION} main" >> /etc/apt/sources.list.d/llvm.list
curl -fsSL "https://apt.llvm.org/llvm-snapshot.gpg.key" | apt-key add -
echo "deb https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | apt-key add -
echo "deb https://apt.kitware.com/ubuntu/ focal main" > /etc/apt/sources.list.d/kitware.list
curl -fsSL "https://apt.kitware.com/keys/kitware-archive-latest.asc" | apt-key add -
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "bullseye") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
curl -fsSL https://keys.openpgp.org/vks/v1/by-fingerprint/32A37959C2FA5C3C99EFBC32A79206696452D198 \
  | gpg --batch --yes --dearmor -o /usr/share/keyrings/buildkite-agent-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/buildkite-agent-archive-keyring.gpg] https://apt.buildkite.com/buildkite-agent stable main" \
  | tee /etc/apt/sources.list.d/buildkite-agent.list > /dev/null

# Install dependencies
apt-get update
apt-get install -y \
  bash \
  software-properties-common \
  build-essential \
  autoconf \
  automake \
  libtool \
  pkg-config \
  clang-${LLVM_VERSION} \
  lld-${LLVM_VERSION} \
  lldb-${LLVM_VERSION} \
  clangd-${LLVM_VERSION} \
  libc++-${LLVM_VERSION}-dev \
  libc++abi-${LLVM_VERSION}-dev \
  make \
  cmake \
  ninja-build \
  file \
  libc-dev \
  libxml2 \
  libxml2-dev \
  xz-utils \
  git \
  tar \
  rsync \
  gzip \
  unzip \
  perl \
  python3 \
  ruby \
  ruby-dev \
  golang \
  nodejs \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin \
  buildkite-agent

npm install -g \
  pnpm@${PNPM_VERSION} \
  bun@${BUN_VERSION}

# Read the buildkite token
BUILDKITE_TOKEN="${1}"
if [ -z "$BUILDKITE_TOKEN" ]; then
  echo "No buildkite token."
  exit 1
fi

# Read the buildkite tags
BUILDKITE_TAGS=""
for tag in $(echo "${@:2}" | tr ',' ' '); do
  if [ -z "${BUILDKITE_TAGS}" ]; then
    BUILDKITE_TAGS="${tag}"
  else
    BUILDKITE_TAGS="${BUILDKITE_TAGS},${tag}"
  fi
done

# Enable buildkite
systemctl enable buildkite-agent

# Configure buildkite
BUILDKITE_PATH="/etc/buildkite-agent/buildkite-agent.cfg"
sed -i '' "s/xxx/${BUILDKITE_TOKEN}/g" "${BUILDKITE_PATH}"
sed -i '' "s/# tags=.*/tags=\"${BUILDKITE_TAGS}\"/g" "${BUILDKITE_PATH}"
sed -i '' "s/tags=.*/tags=\"${BUILDKITE_TAGS}\"/g" "${BUILDKITE_PATH}"

# Start buildkite
systemctl start buildkite-agent
systemctl restart buildkite-agent
