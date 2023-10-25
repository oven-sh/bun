ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun
ARG CPU_TARGET=native
ARG ARCH=x86_64
ARG BUILD_MACHINE_ARCH=x86_64
ARG TRIPLET=${ARCH}-linux-gnu
ARG BUILDARCH=amd64
ARG WEBKIT_TAG=2023-oct3-2
ARG WEBKIT_BASENAME="bun-webkit-linux-$BUILDARCH"

ARG BUN_VERSION="1.0.7"
ARG NODE_VERSION="20"
ARG LLVM_VERSION="16"

ARG ZIG_VERSION="0.12.0-dev.899+027aabf49"
ARG ZIG_FOLDERNAME=zig-linux-${BUILD_MACHINE_ARCH}-${ZIG_VERSION}
ARG ZIG_FILENAME=${ZIG_FOLDERNAME}.tar.xz
ARG ZIG_URL="https://ziglang.org/builds/${ZIG_FILENAME}"

ARG WEBKIT_URL="https://github.com/oven-sh/WebKit/releases/download/$WEBKIT_TAG/${WEBKIT_BASENAME}.tar.gz"
ARG GIT_SHA=""
ARG BUN_BASE_VERSION=1.0

FROM bitnami/minideb:bullseye as bun-base

ARG BUN_VERSION
ARG NODE_VERSION
ARG LLVM_VERSION

RUN apt-get update -y \
  && install_packages \
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
  && ln -s /usr/bin/clang-${LLVM_VERSION} /usr/bin/clang \
  && ln -s /usr/bin/clang++-${LLVM_VERSION} /usr/bin/clang++ \
  && ln -s /usr/bin/lld-${LLVM_VERSION} /usr/bin/lld \
  && ln -s /usr/bin/lldb-${LLVM_VERSION} /usr/bin/lldb \
  && ln -s /usr/bin/clangd-${LLVM_VERSION} /usr/bin/clangd \
  && ln -s /usr/bin/llvm-ar-${LLVM_VERSION} /usr/bin/llvm-ar \
  && arch="$(dpkg --print-architecture)" \
  && arch="$(dpkg --print-architecture)" \
  && case "${arch##*-}" in \
  amd64) variant="x64";; \
  arm64) variant="aarch64";; \
  *) echo "error: unsupported architecture: $arch"; exit 1 ;; \
  esac \
  && wget "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${variant}.zip" \
  && unzip bun-linux-${variant}.zip \
  && mv bun-linux-${variant}/bun /usr/bin/bun \
  && ln -s /usr/bin/bun /usr/bin/bunx \
  && rm -rf bun-linux-${variant} bun-linux-${variant}.zip

ENV CXX=clang++-16
ENV CC=clang-16

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG BUILDARCH
ARG ZIG_PATH
ARG WEBKIT_URL
ARG ZIG_URL
ARG ZIG_FOLDERNAME
ARG ZIG_FILENAME

ENV WEBKIT_OUT_DIR=${WEBKIT_DIR}
ENV BUILDARCH=${BUILDARCH}
ENV AR=/usr/bin/llvm-ar-16
ENV ZIG "${ZIG_PATH}/zig"
ENV PATH="$ZIG/bin:$PATH"
ENV LD=lld-16

RUN mkdir -p $BUN_DIR $BUN_DEPS_OUT_DIR 

ENV CI 1

FROM bun-base as bun-base-with-zig-and-webkit

WORKDIR $GITHUB_WORKSPACE

ADD $ZIG_URL .
RUN tar xf ${ZIG_FILENAME} && \
  rm ${ZIG_FILENAME} && mv ${ZIG_FOLDERNAME} zig;



WORKDIR $GITHUB_WORKSPACE

ARG GITHUB_WORKSPACE
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG BUILDARCH
ARG ZIG_PATH
ARG WEBKIT_URL
ARG ZIG_URL
ARG WEBKIT_BASENAME

ADD ${WEBKIT_URL} .

RUN mkdir -p ${WEBKIT_DIR} && cd ${GITHUB_WORKSPACE} && \
  gunzip ${WEBKIT_BASENAME}.tar.gz && tar -xf ${WEBKIT_BASENAME}.tar && \
  cat ${WEBKIT_DIR}/include/cmakeconfig.h > /dev/null

LABEL org.opencontainers.image.title="bun base image with zig & webkit ${BUILDARCH} (glibc)"
LABEL org.opencontainers.image.source=https://github.com/oven-sh/bun

FROM bun-base as c-ares

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

ENV CCACHE_DIR=/ccache
ENV JSC_BASE_DIR=${WEBKIT_DIR}
ENV LIB_ICU_PATH=${WEBKIT_DIR}/lib

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/c-ares ${BUN_DIR}/src/deps/c-ares

WORKDIR $BUN_DIR

RUN --mount=type=cache,target=/ccache cd $BUN_DIR && make c-ares && rm -rf ${BUN_DIR}/src/deps/c-ares ${BUN_DIR}/Makefile


FROM bun-base as lolhtml

RUN install_packages build-essential && curl https://sh.rustup.rs -sSf | sh -s -- -y

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR

ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/lol-html ${BUN_DIR}/src/deps/lol-html

ENV CCACHE_DIR=/ccache

RUN --mount=type=cache,target=/ccache export PATH=$PATH:$HOME/.cargo/bin && export CC=$(which clang-16) && cd ${BUN_DIR} && \
  make lolhtml && rm -rf src/deps/lol-html Makefile

FROM bun-base as mimalloc

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/mimalloc ${BUN_DIR}/src/deps/mimalloc
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

ENV CCACHE_DIR=/ccache

RUN --mount=type=cache,target=/ccache cd ${BUN_DIR} && \
  make mimalloc && rm -rf src/deps/mimalloc Makefile

FROM bun-base as zlib

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/zlib ${BUN_DIR}/src/deps/zlib

WORKDIR $BUN_DIR

ENV CCACHE_DIR=/ccache

RUN --mount=type=cache,target=/ccache cd $BUN_DIR && \
  make zlib && rm -rf src/deps/zlib Makefile

FROM bun-base as libarchive

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

RUN install_packages autoconf automake libtool pkg-config 

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/libarchive ${BUN_DIR}/src/deps/libarchive

ENV CCACHE_DIR=/ccache
WORKDIR $BUN_DIR


RUN --mount=type=cache,target=/ccache cd $BUN_DIR && \
  make libarchive && rm -rf src/deps/libarchive Makefile



FROM bun-base as tinycc

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

RUN install_packages libtcc-dev && cp /usr/lib/$(uname -m)-linux-gnu/libtcc.a ${BUN_DEPS_OUT_DIR}

FROM bun-base as boringssl

RUN install_packages golang

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/boringssl ${BUN_DIR}/src/deps/boringssl

WORKDIR $BUN_DIR

ENV CCACHE_DIR=/ccache

RUN --mount=type=cache,target=/ccache cd ${BUN_DIR} && make boringssl && rm -rf src/deps/boringssl Makefile

FROM bun-base as uws

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY packages/bun-uws ${BUN_DIR}/packages/bun-uws
COPY packages/bun-usockets ${BUN_DIR}/packages/bun-usockets
COPY src/deps/zlib ${BUN_DIR}/src/deps/zlib
COPY src/deps/boringssl/include ${BUN_DIR}/src/deps/boringssl/include
COPY src/deps/c-ares/include ${BUN_DIR}/src/deps/c-ares/include
COPY src/deps/libuwsockets.cpp ${BUN_DIR}/src/deps/libuwsockets.cpp
COPY src/deps/_libusockets.h ${BUN_DIR}/src/deps/_libusockets.h

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
  make uws && rm -rf packages/bun-uws Makefile

FROM bun-base as base64

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/base64 ${BUN_DIR}/src/deps/base64

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
  make base64 && rm -rf src/deps/base64 Makefile

FROM bun-base as picohttp

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/picohttpparser ${BUN_DIR}/src/deps/picohttpparser
COPY src/deps/*.c ${BUN_DIR}/src/deps/
COPY src/deps/*.h ${BUN_DIR}/src/deps/

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
  make picohttp


FROM bun-base-with-zig-and-webkit as identifier_cache

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

WORKDIR $BUN_DIR

COPY Makefile ${BUN_DIR}/Makefile
COPY src/js_lexer/identifier_data.zig ${BUN_DIR}/src/js_lexer/identifier_data.zig
COPY src/js_lexer/identifier_cache.zig ${BUN_DIR}/src/js_lexer/identifier_cache.zig

RUN cd $BUN_DIR && \
  make identifier-cache && rm -rf zig-cache Makefile

FROM bun-base-with-zig-and-webkit as node_fallbacks

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

WORKDIR $BUN_DIR


COPY Makefile ${BUN_DIR}/Makefile
COPY src/node-fallbacks ${BUN_DIR}/src/node-fallbacks
RUN cd $BUN_DIR && \
  make node-fallbacks && rm -rf src/node-fallbacks/node_modules Makefile

FROM bun-base-with-zig-and-webkit as prepare_release

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

WORKDIR $BUN_DIR

COPY ./root.zig ${BUN_DIR}/root.zig
COPY ./src ${BUN_DIR}/src
COPY ./build.zig ${BUN_DIR}/build.zig
COPY ./completions ${BUN_DIR}/completions
COPY ./packages ${BUN_DIR}/packages
COPY ./src/build-id ${BUN_DIR}/src/build-id
COPY ./package.json ${BUN_DIR}/package.json
COPY ./misctools ${BUN_DIR}/misctools
COPY Makefile ${BUN_DIR}/Makefile


FROM prepare_release as compile_release_obj

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY .prettierrc.cjs ${BUN_DIR}/.prettierrc.cjs

WORKDIR $BUN_DIR

ENV JSC_BASE_DIR=${WEBKIT_DIR}
ENV LIB_ICU_PATH=${WEBKIT_DIR}/lib
ARG ARCH
ARG TRIPLET
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}
ARG GIT_SHA
ARG BUN_BASE_VERSION

ENV BUN_BASE_VERSION=${BUN_BASE_VERSION}
ENV GIT_SHA=${GIT_SHA}

COPY --from=identifier_cache ${BUN_DIR}/src/js_lexer/*.blob ${BUN_DIR}/src/js_lexer/
COPY --from=node_fallbacks ${BUN_DIR}/src/node-fallbacks/out ${BUN_DIR}/src/node-fallbacks/out

COPY ./src/build-id ${BUN_DIR}/src/build-id

ENV CCACHE_DIR=/ccache

RUN --mount=type=cache,target=/ccache cd $BUN_DIR \
  && mkdir -p src/bun.js/bindings-obj \
  && rm -rf $HOME/.cache zig-cache && make prerelease \
  && mkdir -p $BUN_RELEASE_DIR \
  && OUTPUT_DIR=/tmp/bun-${TRIPLET}-${GIT_SHA} $ZIG_PATH/zig build obj -Doutput-file=/tmp/bun-${TRIPLET}-${GIT_SHA}/bun.o -Doptimize=ReleaseFast -Dtarget="${TRIPLET}" -Dcpu="${CPU_TARGET}" \
  && cp /tmp/bun-${TRIPLET}-${GIT_SHA}/bun.o /tmp/bun-${TRIPLET}-${GIT_SHA}/bun-${BUN_BASE_VERSION}.$(cat ${BUN_DIR}/src/build-id).o && cd / \
  && rm -rf $BUN_DIR

FROM prepare_release as compile_cpp

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY .prettierrc.cjs ${BUN_DIR}/.prettierrc.cjs

WORKDIR $BUN_DIR

ENV JSC_BASE_DIR=${WEBKIT_DIR}
ENV LIB_ICU_PATH=${WEBKIT_DIR}/lib

# Required for webcrypto bindings
COPY src/deps/boringssl/include ${BUN_DIR}/src/deps/boringssl/include

ENV CCACHE_DIR=/ccache

RUN --mount=type=cache,target=/ccache cd $BUN_DIR && mkdir -p src/bun.js/bindings-obj &&  rm -rf $HOME/.cache zig-cache && mkdir -p $BUN_RELEASE_DIR && \
  make release-bindings -j10 && mv src/bun.js/bindings-obj/* /tmp

FROM bun-base as sqlite

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR

ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

ENV CCACHE_DIR=/ccache

COPY Makefile ${BUN_DIR}/Makefile
COPY src/bun.js/bindings/sqlite ${BUN_DIR}/src/bun.js/bindings/sqlite
COPY .prettierrc.cjs ${BUN_DIR}/.prettierrc.cjs

WORKDIR $BUN_DIR

ENV JSC_BASE_DIR=${WEBKIT_DIR}
ENV LIB_ICU_PATH=${WEBKIT_DIR}/lib

RUN --mount=type=cache,target=/ccache cd $BUN_DIR && make sqlite

FROM bun-base as zstd

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR

ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

ENV CCACHE_DIR=/ccache

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/zstd ${BUN_DIR}/src/deps/zstd
COPY .prettierrc.cjs ${BUN_DIR}/.prettierrc.cjs

WORKDIR $BUN_DIR

ENV JSC_BASE_DIR=${WEBKIT_DIR}
ENV LIB_ICU_PATH=${WEBKIT_DIR}/lib

RUN --mount=type=cache,target=/ccache cd $BUN_DIR && make zstd

FROM scratch as build_release_cpp

COPY --from=compile_cpp /tmp/*.o /

FROM prepare_release as build_release

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY Makefile ${BUN_DIR}/Makefile
COPY .prettierrc.cjs ${BUN_DIR}/.prettierrc.cjs

WORKDIR $BUN_DIR

ENV JSC_BASE_DIR=${WEBKIT_DIR}
ENV LIB_ICU_PATH=${WEBKIT_DIR}/lib

COPY --from=zlib ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=base64 ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=libarchive ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=boringssl ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=lolhtml ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=mimalloc ${BUN_DEPS_OUT_DIR}/*.o ${BUN_DEPS_OUT_DIR}/
COPY --from=picohttp ${BUN_DEPS_OUT_DIR}/*.o ${BUN_DEPS_OUT_DIR}/
COPY --from=sqlite ${BUN_DEPS_OUT_DIR}/*.o  ${BUN_DEPS_OUT_DIR}/
COPY --from=zstd ${BUN_DEPS_OUT_DIR}/*.a  ${BUN_DEPS_OUT_DIR}/
COPY --from=tinycc ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=uws ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=uws ${BUN_DEPS_OUT_DIR}/*.o ${BUN_DEPS_OUT_DIR}/
COPY --from=c-ares ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/

COPY --from=build_release_obj /*.o /tmp
COPY --from=build_release_cpp /*.o ${BUN_DIR}/src/bun.js/bindings-obj/
COPY --from=build_release_cpp /*.a ${BUN_DEPS_OUT_DIR}/

RUN cd $BUN_DIR && mkdir -p ${BUN_RELEASE_DIR} && make bun-relink copy-to-bun-release-dir && \
  rm -rf $HOME/.cache zig-cache misctools package.json build-id completions build.zig $(BUN_DIR)/packages



FROM scratch as artifact

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR

COPY --from=build_release ${BUN_RELEASE_DIR}/bun /bun
COPY --from=build_release ${BUN_RELEASE_DIR}/bun-profile /bun-profile
COPY --from=build_release ${BUN_DEPS_OUT_DIR}/* /bun-dependencies
COPY --from=build_release_obj /*.o /bun-obj


FROM prepare_release as build_unit

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG BUN_DIR

WORKDIR $BUN_DIR

ENV PATH "$ZIG_PATH:$PATH"
ENV LIB_ICU_PATH "${WEBKIT_DIR}/lib"

CMD make headers \
  api \
  analytics \
  bun_error \
  fallback_decoder \
  bindings -j10 && \
  make \
  run-all-unit-tests



# FROM bun-test-base as test_base

# ARG DEBIAN_FRONTEND=noninteractive
# ARG GITHUB_WORKSPACE=/build
# ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# # Directory extracts to "bun-webkit"
# ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
# ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
# ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
# ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

# ARG BUILDARCH=amd64
# RUN groupadd -r chromium && useradd   -d  ${BUN_DIR} -M -r -g chromium -G audio,video chromium \
#     && mkdir -p /home/chromium/Downloads && chown -R chromium:chromium /home/chromium

# USER chromium
# WORKDIR $BUN_DIR

# ENV NPM_CLIENT bun
# ENV PATH "${BUN_DIR}/packages/bun-linux-x64:${BUN_DIR}/packages/bun-linux-aarch64:$PATH"
# ENV CI 1
# ENV BROWSER_EXECUTABLE /usr/bin/chromium

# COPY ./test ${BUN_DIR}/test
# COPY Makefile ${BUN_DIR}/Makefile
# COPY package.json ${BUN_DIR}/package.json
# COPY .docker/run-test.sh ${BUN_DIR}/run-test.sh
# COPY ./bun.lockb ${BUN_DIR}/bun.lockb   

# # # We don't want to worry about architecture differences in this image
# COPY --from=release /opt/bun/bin/bun ${BUN_DIR}/packages/bun-linux-aarch64/bun
# COPY --from=release /opt/bun/bin/bun ${BUN_DIR}/packages/bun-linux-x64/bun

# USER root
# RUN chgrp -R chromium ${BUN_DIR} && chmod g+rwx ${BUN_DIR} && chown -R chromium:chromium ${BUN_DIR}
# USER chromium

# CMD [ "bash", "run-test.sh" ]

# FROM release

FROM bun-base as bun-base-with-zig

ARG ZIG_VERSION
ARG BUILD_MACHINE_ARCH
ARG ZIG_FOLDERNAME=zig-linux-${BUILD_MACHINE_ARCH}-${ZIG_VERSION}
ARG ZIG_FILENAME=${ZIG_FOLDERNAME}.tar.xz
ARG ZIG_URL="https://ziglang.org/builds/${ZIG_FILENAME}"

WORKDIR $GITHUB_WORKSPACE

ADD $ZIG_URL .
RUN tar xf ${ZIG_FILENAME} && \
  rm ${ZIG_FILENAME} && mv ${ZIG_FOLDERNAME} zig;

FROM bun-base-with-zig as bun-compile-zig-obj

ARG ZIG_PATH
ARG TRIPLET
ARG GIT_SHA
ARG CPU_TARGET

# TODO: why is prettierrc needed by src/api/schema.js
COPY *.zig package.json bun.lockb CMakeLists.txt .prettierrc.cjs Makefile ./
COPY completions ./completions
COPY packages ./packages
COPY src ./src

RUN bun install --frozen-lockfile \
  && make runtime_js fallback_decoder bun_error node-fallbacks \
  && mkdir -p build \
  && cd build \
  && mkdir -p codegen tmp_modules tmp_functions js \
  && cmake .. \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCPU_TARGET="${CPU_TARGET}" \
  -DZIG_TARGET="${TRIPLET}" \
  -DZIG_COMPILER="${ZIG_PATH}/zig" \
  -DWEBKIT_DIR="omit" \
  -DNO_CONFIGURE_DEPENDS=1 \
  -DBUN_ZIG_OBJ="/tmp/bun-${TRIPLET}-${GIT_SHA}/bun-zig.o"  \
  && ninja "/tmp/bun-${TRIPLET}-${GIT_SHA}/bun-zig.o"

FROM scratch as build_release_obj

ARG DEBIAN_FRONTEND
ARG GITHUB_WORKSPACE
ARG ZIG_PATH
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR
ARG BUN_RELEASE_DIR
ARG BUN_DEPS_OUT_DIR
ARG GIT_SHA
ARG TRIPLET
ARG BUN_DIR
ARG CPU_TARGET
ENV CPU_TARGET=${CPU_TARGET}

COPY --from=bun-compile-zig-obj /tmp/bun-${TRIPLET}-${GIT_SHA}/*.o /
