ARG LLVM_VERSION="21"
ARG REPORTED_LLVM_VERSION="21.1.8"
ARG OLD_BUN_VERSION="1.3.13"
ARG BUILDKITE_AGENT_TAGS="queue=linux,os=linux,arch=${TARGETARCH}"

FROM --platform=$BUILDPLATFORM ubuntu:20.04 as base-arm64
FROM --platform=$BUILDPLATFORM ubuntu:20.04 as base-amd64
FROM base-$TARGETARCH as base

ARG LLVM_VERSION
ARG OLD_BUN_VERSION
ARG TARGETARCH
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
   ca-certificates gnupg lsb-release unzip xz-utils \
   libxml2-dev ruby ruby-dev bison gawk perl make golang ccache qemu-user-static \
   libc6-dev \
   # gcc-13 on focal: Launchpad ppa:ubuntu-toolchain-r/test times out / 503s
   # often enough to break image builds, so install from a mirrored snapshot
   # of the PPA's .debs instead. See oven-sh/WebKit release gcc-13-focal-debs.
   && mkdir /tmp/gcc13 \
   && wget -qO- "https://github.com/oven-sh/WebKit/releases/download/gcc-13-focal-debs/gcc-13-focal-${TARGETARCH}.tar.gz" \
      | tar -xz -C /tmp/gcc13 \
   && apt-get install -y --no-install-recommends /tmp/gcc13/*.deb \
   && rm -rf /tmp/gcc13 \
   && wget https://apt.llvm.org/llvm.sh \
   && chmod +x llvm.sh \
   && ./llvm.sh ${LLVM_VERSION} all \
   && rm llvm.sh \
   && rm -rf /var/lib/apt/lists/*


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
   C_INCLUDE_PATH=/usr/lib/gcc/${ARCH_PATH}/13/include

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

# Node — build scripts run under node (see scripts/build.ts). Version must
# match scripts/bootstrap.sh nodejs_version_exact() so container and bare-
# metal agents use the same runtime. .tar.gz (not .xz) to match bootstrap.sh
# and avoid needing xz-utils.
ARG NODE_VERSION="24.3.0"
RUN ARCH=$(if [ "$TARGETARCH" = "arm64" ]; then echo "arm64"; else echo "x64"; fi) && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.gz" \
      | tar -xz -C /usr/local --strip-components=1 && \
    node --version

ENV LLVM_VERSION=${REPORTED_LLVM_VERSION}

WORKDIR /workspace


FROM --platform=$BUILDPLATFORM base as buildkite
ARG BUILDKITE_AGENT_TAGS


# Install Rust nightly
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && export PATH=$HOME/.cargo/bin:$PATH \
    && rustup install nightly \
    && rustup default nightly \
    && rustup target add aarch64-linux-android x86_64-linux-android \
    && rustup target add x86_64-unknown-freebsd \
    && rustup component add rust-src

# Android NDK — sysroot/libc++/compiler-rt for --abi=android cross-compile.
ARG ANDROID_NDK_VERSION="r27c"
RUN curl -fsSL "https://dl.google.com/android/repository/android-ndk-${ANDROID_NDK_VERSION}-linux.zip" -o /tmp/ndk.zip \
    && unzip -q /tmp/ndk.zip -d /opt \
    && mv /opt/android-ndk-${ANDROID_NDK_VERSION} /opt/android-ndk \
    && rm /tmp/ndk.zip \
    # Trim ~1.1GB we don't use (NDK clang/lld, lldb, non-android runtimes) —
    # we only need sysroot + android compiler-rt. Dramatically shrinks the
    # docker layer / AMI size.
    && rm -rf /opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/bin \
              /opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/python3 \
              /opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/lib/liblldb.so \
              /opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/lib/*-gnu \
              /opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/lib/*-musl* \
              /opt/android-ndk/simpleperf /opt/android-ndk/shader-tools /opt/android-ndk/sources \
    # Symlink NDK compiler-rt builtins + libunwind into host clang's resource
    # dir — clang's driver hardcodes <resource-dir>/lib/<triple>/libclang_rt.*
    # with no -L fallback. Done at image-build time (root) since the build
    # user can't write to /usr.
    && RES=$(clang -print-resource-dir) \
    && NDK_RT=/opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/lib/clang/$(ls /opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/lib/clang/)/lib/linux \
    && mkdir -p $RES/lib/linux \
    && for A in aarch64 x86_64; do \
         ln -sf $NDK_RT/libclang_rt.builtins-${A}-android.a $RES/lib/linux/; \
         mkdir -p $RES/lib/linux/${A}; \
         ln -sf $NDK_RT/${A}/libunwind.a $RES/lib/linux/${A}/; \
         DIR=$RES/lib/${A}-unknown-linux-android28; \
         mkdir -p $DIR; \
         ln -sf $NDK_RT/libclang_rt.builtins-${A}-android.a $DIR/libclang_rt.builtins.a; \
         ln -sf $NDK_RT/${A}/libunwind.a $DIR/libunwind.a; \
       done
ENV ANDROID_NDK_ROOT=/opt/android-ndk

# FreeBSD sysroot — extracted base.txz for --os=freebsd cross-compile.
# Only the matching arch is fetched (x64 image gets amd64 sysroot, etc.).
ARG FREEBSD_VERSION="14.3"
RUN FBSD_ARCH=$(if [ "$TARGETARCH" = "arm64" ]; then echo "arm64"; else echo "amd64"; fi) \
    && mkdir -p /opt/freebsd-sysroot \
    && curl -fsSL "https://download.freebsd.org/releases/${FBSD_ARCH}/${FREEBSD_VERSION}-RELEASE/base.txz" -o /tmp/base.txz \
    && tar -C /opt/freebsd-sysroot --no-same-owner -xJf /tmp/base.txz ./usr/include ./usr/lib ./lib \
    && rm /tmp/base.txz
ENV FREEBSD_SYSROOT=/opt/freebsd-sysroot

RUN ARCH=$(if [ "$TARGETARCH" = "arm64" ]; then echo "arm64"; else echo "amd64"; fi) && \
    echo "Downloading buildkite" && \
    curl -fsSL "https://github.com/buildkite/agent/releases/download/v3.87.0/buildkite-agent-linux-${ARCH}-3.87.0.tar.gz" -o /tmp/buildkite-agent.tar.gz && \
    mkdir -p /tmp/buildkite-agent && \
    tar -xzf /tmp/buildkite-agent.tar.gz -C /tmp/buildkite-agent && \
    mv /tmp/buildkite-agent/buildkite-agent /usr/bin/buildkite-agent

RUN mkdir -p /var/cache/buildkite-agent /var/log/buildkite-agent /var/run/buildkite-agent /etc/buildkite-agent /var/lib/buildkite-agent/cache/bun

# Warm BUN_BUILD_PREFETCH_DIR (consulted by scripts/build/download.ts before
# any network fetch). Content-addressed by URL/identity, so a dep version bump
# in scripts/build/deps/ just misses the cache for that one dep — no image
# rebuild needed. The clone is only for scripts/prefetch-deps.ts + its
# scripts/build/ imports, which aren't in the docker context.
ARG BUN_REPO_REF=main
RUN set -e; \
    if git clone --depth=1 --branch ${BUN_REPO_REF} https://github.com/oven-sh/bun.git /tmp/bun-clone \
       && [ -f /tmp/bun-clone/scripts/prefetch-deps.ts ]; then \
         (cd /tmp/bun-clone && bun scripts/prefetch-deps.ts /opt/bun-prefetch); \
       else \
         echo "warning: prefetch-deps.ts unavailable at ${BUN_REPO_REF}; skipping warm cache"; \
       fi; \
    rm -rf /tmp/bun-clone
ENV BUN_BUILD_PREFETCH_DIR=/opt/bun-prefetch

# The following is necessary to configure buildkite to use a stable
# checkout directory for ccache to be effective.
RUN mkdir -p -m 755 /var/lib/buildkite-agent/hooks && \
    cat <<'EOF' > /var/lib/buildkite-agent/hooks/environment
#!/bin/sh
set -efu

export BUILDKITE_BUILD_CHECKOUT_PATH=/var/lib/buildkite-agent/build
export BUN_BUILD_PREFETCH_DIR=/opt/bun-prefetch
EOF

RUN chmod 744 /var/lib/buildkite-agent/hooks/environment

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
    && rustup default nightly \
    && rustup target add aarch64-linux-android x86_64-linux-android \
    && rustup target add x86_64-unknown-freebsd \
    && rustup component add rust-src

ENV PATH=/root/.cargo/bin:$PATH

ENV LLVM_VERSION=${REPORTED_LLVM_VERSION}


RUN --mount=type=tmpfs,target=/workspace/bun/build \
    ls -la \
    && bun run build:release \
    && mkdir -p /target \
    && cp -r /workspace/bun/build/release/bun /target/bun
