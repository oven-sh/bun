ARG LLVM_VERSION="18"
ARG REPORTED_LLVM_VERSION="18.1.8"
ARG OLD_BUN_VERSION="1.1.38"
ARG DEFAULT_CFLAGS="-mno-omit-leaf-frame-pointer -fno-omit-frame-pointer -ffunction-sections -fdata-sections -faddrsig -fno-unwind-tables -fno-asynchronous-unwind-tables"
ARG DEFAULT_CXXFLAGS="-flto=full -fwhole-program-vtables -fforce-emit-vtables"
ARG BUILDKITE_AGENT_TAGS="queue=linux,os=linux,arch=${TARGETARCH}"

FROM --platform=$BUILDPLATFORM ubuntu:20.04 as base-arm64
FROM --platform=$BUILDPLATFORM ubuntu:18.04 as base-amd64
FROM base-$TARGETARCH as base

ARG LLVM_VERSION
ARG OLD_BUN_VERSION
ARG TARGETARCH
ARG DEFAULT_CXXFLAGS
ARG DEFAULT_CFLAGS
ARG REPORTED_LLVM_VERSION

ENV DEBIAN_FRONTEND=noninteractive \
   CI=true \
   DOCKER=true

RUN echo "Acquire::Queue-Mode \"host\";" > /etc/apt/apt.conf.d/99-apt-queue-mode.conf \
    && echo "Acquire::Timeout \"120\";" >> /etc/apt/apt.conf.d/99-apt-timeout.conf \
    && echo "Acquire::Retries \"3\";" >> /etc/apt/apt.conf.d/99-apt-retries.conf \
    && echo "APT::Install-Recommends \"false\";" >> /etc/apt/apt.conf.d/99-apt-install-recommends.conf \
    && echo "APT::Install-Suggests \"false\";" >> /etc/apt/apt.conf.d/99-apt-install-suggests.conf

RUN apt-get update && apt-get install -y --no-install-recommends \
   wget curl git python3 python3-pip ninja-build \
   software-properties-common apt-transport-https \
   ca-certificates gnupg lsb-release unzip \
   libxml2-dev ruby ruby-dev bison gawk perl make golang \
   && add-apt-repository ppa:ubuntu-toolchain-r/test \
   && apt-get update \
   && apt-get install -y gcc-13 g++-13 libgcc-13-dev libstdc++-13-dev \
       libasan6 libubsan1 libatomic1 libtsan0 liblsan0 \
       libgfortran5 libc6-dev \
   && wget https://apt.llvm.org/llvm.sh \
   && chmod +x llvm.sh \
   && ./llvm.sh ${LLVM_VERSION} all \
   && rm llvm.sh


RUN --mount=type=tmpfs,target=/tmp \
    cmake_version="3.30.5" && \
    if [ "$TARGETARCH" = "arm64" ]; then \
        cmake_url="https://github.com/Kitware/CMake/releases/download/v${cmake_version}/cmake-${cmake_version}-linux-aarch64.sh"; \
    else \
        cmake_url="https://github.com/Kitware/CMake/releases/download/v${cmake_version}/cmake-${cmake_version}-linux-x86_64.sh"; \
    fi && \
    wget -O /tmp/cmake.sh "$cmake_url" && \
    sh /tmp/cmake.sh --skip-license --prefix=/usr

RUN update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-13 130 \
   --slave /usr/bin/g++ g++ /usr/bin/g++-13 \
   --slave /usr/bin/gcc-ar gcc-ar /usr/bin/gcc-ar-13 \
   --slave /usr/bin/gcc-nm gcc-nm /usr/bin/gcc-nm-13 \
   --slave /usr/bin/gcc-ranlib gcc-ranlib /usr/bin/gcc-ranlib-13

RUN echo "ARCH_PATH=$([ "$TARGETARCH" = "arm64" ] && echo "aarch64-linux-gnu" || echo "x86_64-linux-gnu")" >> /etc/environment \
   && echo "BUN_ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "aarch64" || echo "x64")" >> /etc/environment

ENV LD_LIBRARY_PATH=/usr/lib/gcc/${ARCH_PATH}/13:/usr/lib/${ARCH_PATH} \
   LIBRARY_PATH=/usr/lib/gcc/${ARCH_PATH}/13:/usr/lib/${ARCH_PATH} \
   CPLUS_INCLUDE_PATH=/usr/include/c++/13:/usr/include/${ARCH_PATH}/c++/13 \
   C_INCLUDE_PATH=/usr/lib/gcc/${ARCH_PATH}/13/include \
   CFLAGS=${DEFAULT_CFLAGS} \
   CXXFLAGS="${DEFAULT_CFLAGS} ${DEFAULT_CXXFLAGS}"

RUN if [ "$TARGETARCH" = "arm64" ]; then \
       export ARCH_PATH="aarch64-linux-gnu"; \
   else \
       export ARCH_PATH="x86_64-linux-gnu"; \
   fi \
   && mkdir -p /usr/lib/gcc/${ARCH_PATH}/13 \
   && ln -sf /usr/lib/${ARCH_PATH}/libstdc++.so.6 /usr/lib/gcc/${ARCH_PATH}/13/ \
   && echo "/usr/lib/gcc/${ARCH_PATH}/13" > /etc/ld.so.conf.d/gcc-13.conf \
   && echo "/usr/lib/${ARCH_PATH}" >> /etc/ld.so.conf.d/gcc-13.conf \
   && ldconfig

RUN for f in /usr/lib/llvm-${LLVM_VERSION}/bin/*; do ln -sf "$f" /usr/bin; done \
   && ln -sf /usr/bin/clang-${LLVM_VERSION} /usr/bin/clang \
   && ln -sf /usr/bin/clang++-${LLVM_VERSION} /usr/bin/clang++ \
   && ln -sf /usr/bin/lld-${LLVM_VERSION} /usr/bin/lld \
   && ln -sf /usr/bin/lldb-${LLVM_VERSION} /usr/bin/lldb \
   && ln -sf /usr/bin/clangd-${LLVM_VERSION} /usr/bin/clangd \
   && ln -sf /usr/bin/llvm-ar-${LLVM_VERSION} /usr/bin/llvm-ar \
   && ln -sf /usr/bin/ld.lld /usr/bin/ld \
   && ln -sf /usr/bin/clang /usr/bin/cc \
   && ln -sf /usr/bin/clang++ /usr/bin/c++

ENV CC="clang" \
   CXX="clang++" \
   AR="llvm-ar-${LLVM_VERSION}" \
   RANLIB="llvm-ranlib-${LLVM_VERSION}" \
   LD="lld-${LLVM_VERSION}"

RUN --mount=type=tmpfs,target=/tmp \
   bash -c '\
      set -euxo pipefail && \
      source /etc/environment && \
      echo "Downloading bun-v${OLD_BUN_VERSION}/bun-linux-$BUN_ARCH.zip from https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/bun-v${OLD_BUN_VERSION}/bun-linux-$BUN_ARCH.zip" && \
      curl -fsSL https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/bun-v${OLD_BUN_VERSION}/bun-linux-$BUN_ARCH.zip -o /tmp/bun.zip && \
      unzip /tmp/bun.zip -d /tmp/bun && \
      mv /tmp/bun/*/bun /usr/bin/bun && \
      chmod +x /usr/bin/bun'

ENV LLVM_VERSION=${REPORTED_LLVM_VERSION}

WORKDIR /workspace


FROM --platform=$BUILDPLATFORM base as buildkite
ARG BUILDKITE_AGENT_TAGS


# Install Rust nightly
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \ 
    && export PATH=$HOME/.cargo/bin:$PATH \
    && rustup install nightly \
    && rustup default nightly


RUN ARCH=$(if [ "$TARGETARCH" = "arm64" ]; then echo "arm64"; else echo "amd64"; fi) && \
    echo "Downloading buildkite" && \ 
    curl -fsSL "https://github.com/buildkite/agent/releases/download/v3.87.0/buildkite-agent-linux-${ARCH}-3.87.0.tar.gz" -o /tmp/buildkite-agent.tar.gz && \
    mkdir -p /tmp/buildkite-agent && \
    tar -xzf /tmp/buildkite-agent.tar.gz -C /tmp/buildkite-agent && \
    mv /tmp/buildkite-agent/buildkite-agent /usr/bin/buildkite-agent

RUN mkdir -p /var/cache/buildkite-agent /var/log/buildkite-agent /var/run/buildkite-agent /etc/buildkite-agent /var/lib/buildkite-agent/cache/bun

COPY  ../*/agent.mjs /var/bun/scripts/

ENV BUN_INSTALL_CACHE=/var/lib/buildkite-agent/cache/bun
ENV BUILDKITE_AGENT_TAGS=${BUILDKITE_AGENT_TAGS}


WORKDIR /var/bun/scripts

ENV PATH=/root/.cargo/bin:$PATH


CMD ["bun", "/var/bun/scripts/agent.mjs", "start"]

FROM --platform=$BUILDPLATFORM base as bun-build-linux-local

ARG LLVM_VERSION
WORKDIR /workspace/bun

COPY . /workspace/bun


# Install Rust nightly
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \ 
    && export PATH=$HOME/.cargo/bin:$PATH \
    && rustup install nightly \
    && rustup default nightly

ENV PATH=/root/.cargo/bin:$PATH

ENV LLVM_VERSION=${REPORTED_LLVM_VERSION}


RUN --mount=type=tmpfs,target=/workspace/bun/build \
    ls -la \
    && bun run build:release \
    && mkdir -p /target \
    && cp -r /workspace/bun/build/release/bun /target/bun