# This Dockerfile is used by CI workflows to build Bun. It is not intended as a development
# environment, or to be used as a base image for other projects.
#
# You likely want this image instead: https://hub.docker.com/r/oven/bun
#
# TODO: move this file to reduce confusion
ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun
ARG CPU_TARGET=native
ARG ARCH=x86_64
ARG BUILD_MACHINE_ARCH=x86_64
ARG BUILDARCH=amd64
ARG TRIPLET=${ARCH}-linux-gnu
ARG GIT_SHA=""
ARG BUN_VERSION="bun-v1.1.4"
ARG BUN_DOWNLOAD_URL_BASE="https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${BUN_VERSION}"
ARG CANARY=0
ARG ASSERTIONS=OFF
ARG ZIG_OPTIMIZE=ReleaseFast
ARG CMAKE_BUILD_TYPE=Release

ARG NODE_VERSION="20"
ARG LLVM_VERSION="16"

ARG ZIG_VERSION="0.13.0"
ARG ZIG_VERSION_SHORT="0.13.0"

ARG SCCACHE_BUCKET
ARG SCCACHE_REGION
ARG SCCACHE_S3_USE_SSL
ARG SCCACHE_ENDPOINT
ARG AWS_ACCESS_KEY_ID
ARG AWS_SECRET_ACCESS_KEY

FROM bitnami/minideb:bullseye as bun-base

ARG BUN_DOWNLOAD_URL_BASE
ARG DEBIAN_FRONTEND
ARG BUN_VERSION
ARG NODE_VERSION
ARG LLVM_VERSION
ARG BUILD_MACHINE_ARCH
ARG BUN_DIR
ARG BUN_DEPS_OUT_DIR
ARG CPU_TARGET

ENV CI 1
ENV CPU_TARGET=${CPU_TARGET}
ENV BUILDARCH=${BUILDARCH}
ENV BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR}
ENV USE_LTO 1

ENV LC_CTYPE=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

ENV SCCACHE_BUCKET=${SCCACHE_BUCKET}
ENV SCCACHE_REGION=${SCCACHE_REGION}
ENV SCCACHE_S3_USE_SSL=${SCCACHE_S3_USE_SSL}
ENV SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT}
ENV AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
ENV AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}

RUN install_packages \
  ca-certificates \
  curl \
  gnupg \
  && echo "deb https://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-${LLVM_VERSION} main" > /etc/apt/sources.list.d/llvm.list \
  && echo "deb-src https://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-${LLVM_VERSION} main" >> /etc/apt/sources.list.d/llvm.list \
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
  clang-${LLVM_VERSION} \
  lld-${LLVM_VERSION} \
  lldb-${LLVM_VERSION} \
  clangd-${LLVM_VERSION} \
  libc++-${LLVM_VERSION}-dev \
  libc++abi-${LLVM_VERSION}-dev \
  llvm-${LLVM_VERSION}-runtime \
  llvm-${LLVM_VERSION}-dev \
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
  nodejs && \
  for f in /usr/lib/llvm-${LLVM_VERSION}/bin/*; do ln -sf "$f" /usr/bin; done \
  && ln -sf /usr/bin/clang-${LLVM_VERSION} /usr/bin/clang \
  && ln -sf /usr/bin/clang++-${LLVM_VERSION} /usr/bin/clang++ \
  && ln -sf /usr/bin/lld-${LLVM_VERSION} /usr/bin/lld \
  && ln -sf /usr/bin/lldb-${LLVM_VERSION} /usr/bin/lldb \
  && ln -sf /usr/bin/clangd-${LLVM_VERSION} /usr/bin/clangd \
  && ln -sf /usr/bin/llvm-ar-${LLVM_VERSION} /usr/bin/llvm-ar \
  && ln -sf /usr/bin/ld.lld /usr/bin/ld \
  && ln -sf /usr/bin/llvm-ranlib-${LLVM_VERSION} /usr/bin/ranlib \
  && ln -sf /usr/bin/clang /usr/bin/cc \
  && ln -sf /usr/bin/clang /usr/bin/c89 \
  && ln -sf /usr/bin/clang /usr/bin/c99 \
  && ln -sf /usr/bin/clang++ /usr/bin/c++ \
  && ln -sf /usr/bin/clang++ /usr/bin/g++ \
  && ln -sf /usr/bin/llvm-ar /usr/bin/ar \
  && ln -sf /usr/bin/clang /usr/bin/gcc \
  && arch="$(dpkg --print-architecture)" \
  && case "${arch##*-}" in \
  amd64) variant="x64";; \
  arm64) variant="aarch64";; \
  *) echo "unsupported architecture: $arch"; exit 1 ;; \
  esac \
  && wget "${BUN_DOWNLOAD_URL_BASE}/bun-linux-${variant}.zip" \
  && unzip bun-linux-${variant}.zip \
  && mv bun-linux-${variant}/bun /usr/bin/bun \
  && ln -s /usr/bin/bun /usr/bin/bunx \
  && rm -rf bun-linux-${variant} bun-linux-${variant}.zip \
  && mkdir -p ${BUN_DIR} ${BUN_DEPS_OUT_DIR}

# && if [ -n "${SCCACHE_BUCKET}" ]; then \
#   echo "Setting up sccache" \
#   && wget https://github.com/mozilla/sccache/releases/download/v0.5.4/sccache-v0.5.4-${BUILD_MACHINE_ARCH}-unknown-linux-musl.tar.gz \
#   && tar xf sccache-v0.5.4-${BUILD_MACHINE_ARCH}-unknown-linux-musl.tar.gz \
#   && mv sccache-v0.5.4-${BUILD_MACHINE_ARCH}-unknown-linux-musl/sccache /usr/bin/sccache \
#   && rm -rf sccache-v0.5.4-${BUILD_MACHINE_ARCH}-unknown-linux-musl.tar.gz sccache-v0.5.4-${BUILD_MACHINE_ARCH}-unknown-linux-musl \

FROM bun-base as bun-base-with-zig

ARG ZIG_VERSION
ARG ZIG_VERSION_SHORT
ARG BUILD_MACHINE_ARCH
ARG ZIG_FOLDERNAME=zig-linux-${BUILD_MACHINE_ARCH}-${ZIG_VERSION}
ARG ZIG_FILENAME=${ZIG_FOLDERNAME}.tar.xz
ARG ZIG_URL="https://ziglang.org/builds/${ZIG_FILENAME}"
ARG ZIG_LOCAL_CACHE_DIR=/zig-cache
ENV ZIG_LOCAL_CACHE_DIR=${ZIG_LOCAL_CACHE_DIR}

WORKDIR $GITHUB_WORKSPACE

ADD $ZIG_URL .
RUN tar xf ${ZIG_FILENAME} \
  && mv ${ZIG_FOLDERNAME}/lib /usr/lib/zig \
  && mv ${ZIG_FOLDERNAME}/zig /usr/bin/zig \
  && rm -rf ${ZIG_FILENAME} ${ZIG_FOLDERNAME}

FROM bun-base as c-ares

ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}
ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/c-ares ${BUN_DIR}/src/deps/c-ares
COPY scripts ${BUN_DIR}/scripts

WORKDIR $BUN_DIR

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd $BUN_DIR \
  && bash ./scripts/build-cares.sh \
  && rm -rf ${BUN_DIR}/src/deps/c-ares ${BUN_DIR}/Makefile ${BUN_DIR}/scripts

FROM bun-base as lolhtml

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y

ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/lol-html ${BUN_DIR}/src/deps/lol-html

ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

RUN --mount=type=cache,target=${CCACHE_DIR} \
  export PATH=$PATH:$HOME/.cargo/bin \
  && cd ${BUN_DIR} \
  && make lolhtml \
  && rm -rf src/deps/lol-html Makefile

FROM bun-base as mimalloc

ARG BUN_DIR
ARG CPU_TARGET
ARG ASSERTIONS
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/mimalloc ${BUN_DIR}/src/deps/mimalloc
COPY scripts ${BUN_DIR}/scripts

ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd ${BUN_DIR} \
  && bash ./scripts/build-mimalloc.sh \
  && rm -rf src/deps/mimalloc Makefile

FROM bun-base as mimalloc-debug

ARG BUN_DIR
ARG CPU_TARGET
ARG ASSERTIONS
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/mimalloc ${BUN_DIR}/src/deps/mimalloc

ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd ${BUN_DIR} \
  && make mimalloc-debug \
  && rm -rf src/deps/mimalloc Makefile

FROM bun-base as zlib

ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}
ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

COPY Makefile ${BUN_DIR}/Makefile
COPY CMakeLists.txt ${BUN_DIR}/CMakeLists.txt
COPY scripts ${BUN_DIR}/scripts
COPY src/deps/zlib ${BUN_DIR}/src/deps/zlib
COPY package.json bun.lockb Makefile .gitmodules ${BUN_DIR}/

WORKDIR $BUN_DIR

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd $BUN_DIR \
  && bash ./scripts/build-zlib.sh && rm -rf src/deps/zlib scripts


FROM bun-base as libdeflate

ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}
ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

COPY Makefile ${BUN_DIR}/Makefile
COPY CMakeLists.txt ${BUN_DIR}/CMakeLists.txt
COPY scripts ${BUN_DIR}/scripts
COPY src/deps/libdeflate ${BUN_DIR}/src/deps/libdeflate
COPY package.json bun.lockb Makefile .gitmodules ${BUN_DIR}/

WORKDIR $BUN_DIR

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd $BUN_DIR \
  && bash ./scripts/build-libdeflate.sh && rm -rf src/deps/libdeflate scripts


FROM bun-base as libarchive

ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}
ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

RUN install_packages autoconf automake libtool pkg-config 

COPY scripts ${BUN_DIR}/scripts
COPY src/deps/libarchive ${BUN_DIR}/src/deps/libarchive

WORKDIR $BUN_DIR

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd $BUN_DIR \
  && bash ./scripts/build-libarchive.sh && rm -rf src/deps/libarchive .scripts

FROM bun-base as tinycc

ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

RUN install_packages libtcc-dev && cp /usr/lib/$(uname -m)-linux-gnu/libtcc.a ${BUN_DEPS_OUT_DIR}

FROM bun-base as boringssl

RUN install_packages golang

ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY scripts ${BUN_DIR}/scripts
COPY src/deps/boringssl ${BUN_DIR}/src/deps/boringssl

WORKDIR $BUN_DIR

ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd ${BUN_DIR} \
  && bash ./scripts/build-boringssl.sh \
  && rm -rf src/deps/boringssl Makefile


FROM bun-base as zstd

ARG BUN_DIR

ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/zstd ${BUN_DIR}/src/deps/zstd
COPY scripts ${BUN_DIR}/scripts

WORKDIR $BUN_DIR

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd $BUN_DIR \
  && bash ./scripts/build-zstd.sh \
  && rm -rf src/deps/zstd scripts

FROM bun-base as ls-hpack

ARG BUN_DIR

ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/ls-hpack ${BUN_DIR}/src/deps/ls-hpack
COPY scripts ${BUN_DIR}/scripts

WORKDIR $BUN_DIR

RUN --mount=type=cache,target=${CCACHE_DIR} \
  cd $BUN_DIR \
  && bash ./scripts/build-lshpack.sh \
  && rm -rf src/deps/ls-hpack scripts

FROM bun-base-with-zig as bun-identifier-cache

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG CPU_TARGET
ARG BUN_DIR
ENV CPU_TARGET=${CPU_TARGET}

WORKDIR $BUN_DIR

COPY src/js_lexer/identifier_data.zig ${BUN_DIR}/src/js_lexer/identifier_data.zig
COPY src/js_lexer/identifier_cache.zig ${BUN_DIR}/src/js_lexer/identifier_cache.zig

RUN --mount=type=cache,target=${ZIG_LOCAL_CACHE_DIR} \
  cd $BUN_DIR \
  && zig run src/js_lexer/identifier_data.zig

FROM bun-base as bun-node-fallbacks

ARG BUN_DIR

WORKDIR $BUN_DIR

COPY src/node-fallbacks ${BUN_DIR}/src/node-fallbacks

RUN cd $BUN_DIR/src/node-fallbacks \
  && bun install --frozen-lockfile \
  && bun run build \
  && rm -rf src/node-fallbacks/node_modules

FROM bun-base as bun-webkit

ARG BUILDARCH
ARG ASSERTIONS

COPY CMakeLists.txt ${BUN_DIR}/CMakeLists.txt

RUN mkdir ${BUN_DIR}/bun-webkit \
  && WEBKIT_TAG=$(grep 'set(WEBKIT_TAG' "${BUN_DIR}/CMakeLists.txt" | awk '{print $2}' | cut -f 1 -d ')') \
  && WEBKIT_SUFFIX=$(if [ "${ASSERTIONS}" = "ON" ]; then echo "debug"; else echo "lto"; fi) \
  && WEBKIT_URL="https://github.com/oven-sh/WebKit/releases/download/autobuild-${WEBKIT_TAG}/bun-webkit-linux-${BUILDARCH}-${WEBKIT_SUFFIX}.tar.gz" \
  && echo "Downloading ${WEBKIT_URL}" \
  && curl -fsSL "${WEBKIT_URL}" | tar -xz -C ${BUN_DIR}/bun-webkit --strip-components=1

FROM bun-base as bun-cpp-objects

ARG CANARY
ARG ASSERTIONS

COPY --from=bun-webkit ${BUN_DIR}/bun-webkit ${BUN_DIR}/bun-webkit

COPY packages ${BUN_DIR}/packages
COPY src ${BUN_DIR}/src
COPY CMakeLists.txt ${BUN_DIR}/CMakeLists.txt
COPY src/deps/boringssl/include ${BUN_DIR}/src/deps/boringssl/include

# for uWebSockets
COPY src/deps/libdeflate ${BUN_DIR}/src/deps/libdeflate

ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

RUN --mount=type=cache,target=${CCACHE_DIR} mkdir ${BUN_DIR}/build \
  && cd ${BUN_DIR}/build \
  && mkdir -p tmp_modules tmp_functions js codegen \
  && cmake .. -GNinja -DCMAKE_BUILD_TYPE=Release -DUSE_LTO=ON -DUSE_DEBUG_JSC=${ASSERTIONS} -DBUN_CPP_ONLY=1 -DWEBKIT_DIR=/build/bun/bun-webkit -DCANARY=${CANARY} -DZIG_COMPILER=system \
  && bash compile-cpp-only.sh -v

FROM bun-base-with-zig as bun-codegen-for-zig

COPY package.json bun.lockb Makefile .gitmodules ${BUN_DIR}/
COPY src/runtime ${BUN_DIR}/src/runtime
COPY src/runtime.js src/runtime.bun.js ${BUN_DIR}/src/
COPY packages/bun-error ${BUN_DIR}/packages/bun-error
COPY packages/bun-types ${BUN_DIR}/packages/bun-types
COPY src/fallback.ts ${BUN_DIR}/src/fallback.ts
COPY src/api ${BUN_DIR}/src/api

WORKDIR $BUN_DIR

# TODO: move away from Makefile entirely
RUN --mount=type=cache,target=${ZIG_LOCAL_CACHE_DIR} \
  bun install --frozen-lockfile \
  && make runtime_js fallback_decoder bun_error \
  && rm -rf src/runtime src/fallback.ts node_modules bun.lockb package.json Makefile

FROM bun-base-with-zig as bun-compile-zig-obj

ARG ZIG_PATH
ARG TRIPLET
ARG GIT_SHA
ARG CPU_TARGET
ARG CANARY=0
ARG ASSERTIONS=OFF
ARG ZIG_OPTIMIZE=ReleaseFast

ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}

COPY *.zig package.json CMakeLists.txt ${BUN_DIR}/
COPY completions ${BUN_DIR}/completions
COPY packages ${BUN_DIR}/packages
COPY src ${BUN_DIR}/src

COPY --from=bun-identifier-cache ${BUN_DIR}/src/js_lexer/*.blob ${BUN_DIR}/src/js_lexer/
COPY --from=bun-node-fallbacks ${BUN_DIR}/src/node-fallbacks/out ${BUN_DIR}/src/node-fallbacks/out
COPY --from=bun-codegen-for-zig ${BUN_DIR}/src/*.out.js ${BUN_DIR}/src/*.out.refresh.js ${BUN_DIR}/src/
COPY --from=bun-codegen-for-zig ${BUN_DIR}/packages/bun-error/dist ${BUN_DIR}/packages/bun-error/dist

WORKDIR $BUN_DIR

RUN --mount=type=cache,target=${CCACHE_DIR} \
  --mount=type=cache,target=${ZIG_LOCAL_CACHE_DIR} \
  mkdir -p build \
  && bun run $BUN_DIR/src/codegen/bundle-modules.ts --debug=OFF $BUN_DIR/build \
  && cd build \
  && cmake .. \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_LTO=ON \
  -DZIG_OPTIMIZE="${ZIG_OPTIMIZE}" \
  -DCPU_TARGET="${CPU_TARGET}" \
  -DZIG_TARGET="${TRIPLET}" \
  -DWEBKIT_DIR="omit" \
  -DNO_CONFIGURE_DEPENDS=1 \
  -DNO_CODEGEN=1 \
  -DBUN_ZIG_OBJ_DIR="/tmp" \
  -DCANARY="${CANARY}" \
  -DZIG_COMPILER=system \
  -DZIG_LIB_DIR=$BUN_DIR/src/deps/zig/lib \
  && ONLY_ZIG=1 ninja "/tmp/bun-zig.o" -v

FROM scratch as build_release_obj

ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY --from=bun-compile-zig-obj /tmp/bun-zig.o /

FROM bun-base as bun-link

ARG CPU_TARGET
ARG CANARY
ARG ASSERTIONS

ENV CPU_TARGET=${CPU_TARGET}
ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}
ARG ZIG_LOCAL_CACHE_DIR=/zig-cache
ENV ZIG_LOCAL_CACHE_DIR=${ZIG_LOCAL_CACHE_DIR}

WORKDIR $BUN_DIR

RUN mkdir -p build bun-webkit

# lol
COPY src/bun.js/bindings/sqlite/sqlite3.c ${BUN_DIR}/src/bun.js/bindings/sqlite/sqlite3.c
COPY src/deps/brotli ${BUN_DIR}/src/deps/brotli

COPY src/symbols.dyn src/linker.lds ${BUN_DIR}/src/

COPY CMakeLists.txt ${BUN_DIR}/CMakeLists.txt
COPY --from=zlib ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=libdeflate ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=libarchive ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=boringssl ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=lolhtml ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=mimalloc ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=zstd ${BUN_DEPS_OUT_DIR}/*  ${BUN_DEPS_OUT_DIR}/
COPY --from=tinycc ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=c-ares ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=ls-hpack ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=bun-compile-zig-obj /tmp/bun-zig.o ${BUN_DIR}/build/bun-zig.o
COPY --from=bun-cpp-objects ${BUN_DIR}/build/*.a ${BUN_DIR}/build/
COPY --from=bun-cpp-objects ${BUN_DIR}/build/*.o ${BUN_DIR}/build/ 
COPY --from=bun-cpp-objects ${BUN_DIR}/bun-webkit/lib ${BUN_DIR}/bun-webkit/lib

WORKDIR $BUN_DIR/build

RUN --mount=type=cache,target=${CCACHE_DIR} \
  --mount=type=cache,target=${ZIG_LOCAL_CACHE_DIR} \
  cmake .. \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUN_LINK_ONLY=1 \
  -DBUN_ZIG_OBJ_DIR="${BUN_DIR}/build" \
  -DUSE_LTO=ON \
  -DUSE_DEBUG_JSC=${ASSERTIONS} \
  -DBUN_CPP_ARCHIVE="${BUN_DIR}/build/bun-cpp-objects.a" \
  -DWEBKIT_DIR="${BUN_DIR}/bun-webkit" \
  -DBUN_DEPS_OUT_DIR="${BUN_DEPS_OUT_DIR}" \
  -DCPU_TARGET="${CPU_TARGET}" \
  -DNO_CONFIGURE_DEPENDS=1 \
  -DCANARY="${CANARY}" \
  -DZIG_COMPILER=system \
  && ninja -v \
  && ./bun --revision \
  && mkdir -p /build/out \
  && mv bun bun-profile /build/out \
  && rm -rf ${BUN_DIR} ${BUN_DEPS_OUT_DIR}

FROM scratch as artifact

COPY --from=bun-link /build/out /

FROM bun-base as bun-link-assertions

ARG CPU_TARGET
ARG CANARY
ARG ASSERTIONS

ENV CPU_TARGET=${CPU_TARGET}
ARG CCACHE_DIR=/ccache
ENV CCACHE_DIR=${CCACHE_DIR}
ARG ZIG_LOCAL_CACHE_DIR=/zig-cache
ENV ZIG_LOCAL_CACHE_DIR=${ZIG_LOCAL_CACHE_DIR}

WORKDIR $BUN_DIR

RUN mkdir -p build bun-webkit

# lol
COPY src/bun.js/bindings/sqlite/sqlite3.c ${BUN_DIR}/src/bun.js/bindings/sqlite/sqlite3.c

COPY src/symbols.dyn src/linker.lds ${BUN_DIR}/src/

COPY CMakeLists.txt ${BUN_DIR}/CMakeLists.txt
COPY --from=zlib ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=libarchive ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=boringssl ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=lolhtml ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=mimalloc-debug ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=zstd ${BUN_DEPS_OUT_DIR}/*  ${BUN_DEPS_OUT_DIR}/
COPY --from=tinycc ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=c-ares ${BUN_DEPS_OUT_DIR}/* ${BUN_DEPS_OUT_DIR}/
COPY --from=bun-compile-zig-obj /tmp/bun-zig.o ${BUN_DIR}/build/bun-zig.o
COPY --from=bun-cpp-objects ${BUN_DIR}/build/bun-cpp-objects.a ${BUN_DIR}/build/bun-cpp-objects.a
COPY --from=bun-cpp-objects ${BUN_DIR}/bun-webkit/lib ${BUN_DIR}/bun-webkit/lib

WORKDIR $BUN_DIR/build

RUN --mount=type=cache,target=${CCACHE_DIR} \
  --mount=type=cache,target=${ZIG_LOCAL_CACHE_DIR} \
  cmake .. \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUN_LINK_ONLY=1 \
  -DBUN_ZIG_OBJ_DIR="${BUN_DIR}/build" \
  -DUSE_DEBUG_JSC=ON \
  -DBUN_CPP_ARCHIVE="${BUN_DIR}/build/bun-cpp-objects.a" \
  -DWEBKIT_DIR="${BUN_DIR}/bun-webkit" \
  -DBUN_DEPS_OUT_DIR="${BUN_DEPS_OUT_DIR}" \
  -DCPU_TARGET="${CPU_TARGET}" \
  -DNO_CONFIGURE_DEPENDS=1 \
  -DCANARY="${CANARY}" \
  -DZIG_COMPILER=system \
  -DUSE_LTO=ON \
  && ninja -v \
  && ./bun --revision \
  && mkdir -p /build/out \
  && mv bun bun-profile /build/out \
  && rm -rf ${BUN_DIR} ${BUN_DEPS_OUT_DIR}

FROM scratch as artifact-assertions

COPY --from=bun-link-assertions /build/out /