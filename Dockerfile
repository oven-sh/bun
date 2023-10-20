FROM bitnami/minideb:bullseye as base

ARG CLANG_VERSION="17"
ARG NODE_VERSION="20"
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
        bash \
        lsb-release \
        software-properties-common \
        clang-${CLANG_VERSION} \
        lld-${CLANG_VERSION} \
        lldb-${CLANG_VERSION} \
        clangd-${CLANG_VERSION} \
        make \
        cmake \
        ccache \
        ninja-build \
        file \
        gnupg \
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
        nodejs \
    && npm install -g esbuild

COPY package.json package.json
COPY Makefile Makefile
COPY CMakeLists.txt CMakeLists.txt
COPY src/ src/ 
COPY packages/bun-usockets/ packages/bun-usockets/
COPY packages/bun-uws/ packages/bun-uws/
COPY .scripts/ .scripts/
COPY *.zig ./

ARG CXX="clang++-${CLANG_VERSION}"
ARG CC="clang-${CLANG_VERSION}"
ARG LD="lld-${CLANG_VERSION}"
ARG AR="/usr/bin/llvm-ar-${CLANG_VERSION}"

RUN npm install && npm run build
