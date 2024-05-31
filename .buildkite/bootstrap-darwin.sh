#! /bin/bash

set -eo pipefail

# Read the buildkite token
BUILDKITE_TOKEN=$1
if [ -z "$BUILDKITE_TOKEN" ]; then
  echo "No buildkite token."
  exit 1
fi

# Install brew
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Pin versions for some dependencies
LLVM_VERSION=16
NODE_VERSION=22
PNPM_VERSION=9
BUN_VERSION=1.1.8

# Install dependencies
brew install --force \
  ca-certificates \
  curl \
  automake \
  ccache \
  cmake \
  coreutils \
  gnu-sed \
  go \
  icu4c \
  libiconv \
  libtool \
  ninja \
  pkg-config \
  rust \
  ruby \
  docker \
  perl \
  llvm@${LLVM_VERSION} \
  node@${NODE_VERSION} \
  pnpm@${PNPM_VERSION} \
  oven-sh/bun/bun@${BUN_VERSION} \
  buildkite/buildkite/buildkite-agent

# Configure buildkite
BUILDKITE_PATH="$(brew --prefix)/etc/buildkite-agent/buildkite-agent.cfg"
sed -i '' "s/xxx/${BUILDKITE_TOKEN}/g" "${BUILDKITE_PATH}"

# Start buildkite
brew services start buildkite-agent
