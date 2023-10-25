FROM bitnami/minideb:bullseye as base

ARG CLANG_VERSION="16"
ARG NODE_VERSION="20"
# Should match what build.zig has
ARG ZIG_VERSION="0.12.0-dev.899+027aabf49"
# This is the version of bun to install, not the one we are building
ARG BUN_VERSION="1.0.7"

ARG DEBIAN_FRONTEND="noninteractive"

RUN apt-get update -y \
    && install_packages \
    ca-certificates \
    curl \
    gnupg \
    && echo "deb https://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-${CLANG_VERSION} main" > /etc/apt/sources.list.d/llvm.list \
    && echo "deb-src https://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-${CLANG_VERSION} main" >> /etc/apt/sources.list.d/llvm.list \
    && curl -fsSL "https://apt.llvm.org/llvm-snapshot.gpg.key" | apt-key add - \
    && echo "deb https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | apt-key add - \
    && echo "deb https://apt.kitware.com/ubuntu/ focal main" > /etc/apt/sources.list.d/kitware.list \
    && curl -fsSL "https://apt.kitware.com/keys/kitware-archive-latest.asc" | apt-key add - \
    && install_packages \
    wget \
    bash \
    software-properties-common \
    build-essential \
    autoconf \
    automake \
    libtool \
    pkg-config \
    clang-${CLANG_VERSION} \
    lld-${CLANG_VERSION} \
    lldb-${CLANG_VERSION} \
    clangd-${CLANG_VERSION} \
    make \
    cmake \
    ccache \
    ninja-build \
    file \
    libc-dev \
    libxml2 \
    libxml2-dev \
    xz-utils \
    libtcc-dev \
    git \
    tar \
    rsync \
    gzip \
    unzip \
    perl \
    python3 \
    ruby \
    golang \
    nodejs \
    && ln -s /usr/bin/clang-${CLANG_VERSION} /usr/bin/clang \
    && ln -s /usr/bin/clang++-${CLANG_VERSION} /usr/bin/clang++ \
    && ln -s /usr/bin/lld-${CLANG_VERSION} /usr/bin/lld \
    && ln -s /usr/bin/lldb-${CLANG_VERSION} /usr/bin/lldb \
    && ln -s /usr/bin/clangd-${CLANG_VERSION} /usr/bin/clangd \
    && ln -s /usr/bin/llvm-ar-${CLANG_VERSION} /usr/bin/llvm-ar \
    && arch="$(dpkg --print-architecture)" \
    && case "${arch##*-}" in \
    amd64) variant="x86_64";; \
    arm64) variant="aarch64";; \
    *) echo "error: unsupported architecture: $arch"; exit 1 ;; \
    esac \
    && curl -fsSL "https://ziglang.org/builds/zig-linux-${variant}-${ZIG_VERSION}.tar.xz" | tar xJ --strip-components=1 \
    && mv zig /usr/bin/zig \
    && wget "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${variant}.zip" \
    && unzip bun-linux-${variant}.zip \
    && mv bun-linux-${variant}/bun /usr/bin/bun \
    && ln -s /usr/bin/bun /usr/bin/bunx \
    && rm -rf bun-linux-${variant} bun-linux-${variant}.zip \
    && curl "https://sh.rustup.rs" -sSf | sh -s -- -y \
    && mv ${HOME}/.cargo/bin/* /usr/bin/

# COPY . .
# COPY package.json package.json
# COPY Makefile Makefile
# COPY CMakeLists.txt CMakeLists.txt
# COPY src/ src/ 
# COPY packages/bun-usockets/ packages/bun-usockets/
# COPY packages/bun-uws/ packages/bun-uws/
# COPY .scripts/ .scripts/
# COPY *.zig ./

ARG CXX="clang++-${CLANG_VERSION}"
ARG CC="clang-${CLANG_VERSION}"
ARG LD="lld-${CLANG_VERSION}"
ARG AR="/usr/bin/llvm-ar-${CLANG_VERSION}"
