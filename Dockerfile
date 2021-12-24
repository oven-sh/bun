FROM ubuntu:20.04 as ubuntu-base
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install --no-install-recommends -y wget gnupg2 curl lsb-release wget software-properties-common

RUN add-apt-repository ppa:longsleep/golang-backports
RUN curl -s https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -

RUN wget https://apt.llvm.org/llvm.sh --no-check-certificate
RUN chmod +x llvm.sh
RUN ./llvm.sh 12

RUN apt-get update && apt-get install --no-install-recommends -y \
    ca-certificates \
    curl \
    gnupg2 \
    software-properties-common \
    cmake \
    build-essential \
    git \
    libssl-dev \
    ruby \
    liblld-12-dev \
    libclang-12-dev \
    nodejs \
    gcc \
    g++ \
    npm \
    clang-12 \
    clang-format-12 \
    libc++-12-dev \
    libc++abi-12-dev \
    lld-12 \
    libicu-dev \
    wget \
    unzip \
    tar \
    golang-go  chromium-browser  ninja-build pkg-config automake autoconf libtool curl

RUN update-alternatives --install /usr/bin/cc cc /usr/bin/clang-12 90 && \
    update-alternatives --install /usr/bin/cpp cpp /usr/bin/clang++-12 90 && \
    update-alternatives --install /usr/bin/c++ c++ /usr/bin/clang++-12 90

ENV CC=clang-12 
ENV CXX=clang++-12

WORKDIR /home/ubuntu
ARG BUILDARCH
ENV ARCH "$BUILDARCH"

RUN npm install -g esbuild

RUN curl -L https://github.com/Jarred-Sumner/zig/releases/download/dec20/zig-linux-$BUILDARCH.zip > zig-linux-$BUILDARCH.zip; \
    unzip -q zig-linux-$BUILDARCH.zip; \
    rm zig-linux-$BUILDARCH.zip;


ENV WEBKIT_OUT_DIR /home/ubuntu/bun-webkit

WORKDIR /home/ubuntu

RUN curl -L https://github.com/Jarred-Sumner/WebKit/releases/download/Bun-v0/bun-webkit-linux-$BUILDARCH.tar.gz > bun-webkit-linux-$BUILDARCH.tar.gz; \
    tar -xzf bun-webkit-linux-$BUILDARCH.tar.gz; \
    rm bun-webkit-linux-$BUILDARCH.tar.gz && cat $WEBKIT_OUT_DIR/include/cmakeconfig.h > /dev/null

WORKDIR /home/ubuntu
RUN curl -L https://github.com/unicode-org/icu/releases/download/release-66-1/icu4c-66_1-src.tgz > icu4c-66_1-src.tgz && \
    tar -xzf icu4c-66_1-src.tgz && \
    rm icu4c-66_1-src.tgz && \
    cd icu/source && \
    ./configure --enable-static --disable-shared && \
    make -j$(nproc)


ENV PATH "/home/ubuntu/zig:$PATH"
ENV JSC_BASE_DIR $WEBKIT_OUT_DIR
ENV LIB_ICU_PATH /home/ubuntu/icu/source/lib
ENV BUN_RELEASE_DIR /home/ubuntu/bun-release


FROM ubuntu-base as build_dependencies

WORKDIR /home/ubuntu/bun



COPY Makefile /home/ubuntu/bun/Makefile
COPY src/deps /home/ubuntu/bun/src/deps
COPY src/js_lexer/identifier_data.zig /home/ubuntu/bun/src/js_lexer/identifier_data.zig
COPY src/js_lexer/identifier_cache.zig /home/ubuntu/bun/src/js_lexer/identifier_cache.zig
COPY src/node-fallbacks /home/ubuntu/bun/src/node-fallbacks

WORKDIR /home/ubuntu/bun

ENV BUN_DEPS_OUT_DIR /home/ubuntu/bun-deps


RUN mkdir -p $BUN_DEPS_OUT_DIR; make \
    mimalloc \
    zlib \
    libarchive \
    boringssl \
    picohttp \
    identifier-cache \
    node-fallbacks 

FROM ubuntu-base as prebuild

ENV BUN_DEPS_OUT_DIR /home/ubuntu/bun-deps


ADD . /home/ubuntu/bun
COPY --from=build_dependencies /home/ubuntu/bun-deps /home/ubuntu/bun-deps
COPY --from=build_dependencies /home/ubuntu/bun/src/node-fallbacks /home/ubuntu/bun/src/node-fallbacks
COPY --from=build_dependencies /home/ubuntu/bun/src/js_lexer/*.blob /home/ubuntu/bun/src/js_lexer

WORKDIR /home/ubuntu/bun

RUN make \
    jsc-bindings-headers \
    api \
    analytics \
    bun_error \
    fallback_decoder 

FROM prebuild as build_release 

WORKDIR /home/ubuntu/bun

RUN release \
    copy-to-bun-release-dir


FROM ubuntu:20.04 as release 

COPY --from=build_release /home/ubuntu/bun-release/bun /opt/bun/bin/bun
COPY .devcontainer/limits.conf /etc/security/limits.conf

ENV BUN_INSTALL /opt/bun
ENV PATH "/opt/bun/bin:$PATH"


FROM ubuntu-base as dev

ENV WEBKIT_OUT_DIR /home/ubuntu/bun-webkit
ENV PATH "/home/ubuntu/zig:$PATH"
ENV JSC_BASE_DIR $WEBKIT_OUT_DIR
ENV LIB_ICU_PATH /home/ubuntu/icu/source/lib
ENV BUN_RELEASE_DIR /home/ubuntu/bun-release
ENV PATH "/workspaces/bun/packages/debug-bun-linux-x64:/workspaces/bun/packages/debug-bun-linux-aarch64:$PATH"
ENV PATH "/home/ubuntu/zls/zig-out/bin:$PATH"

ENV BUN_INSTALL /home/ubuntu/.bun
ENV XDG_CONFIG_HOME /home/ubuntu/.config

RUN update-alternatives --install /usr/bin/lldb lldb /usr/bin/lldb-12 90

COPY .devcontainer/workspace.code-workspace /workspaces/workspace.code-workspace
COPY .devcontainer/zls.json /workspaces/workspace.code-workspace
COPY .devcontainer/limits.conf /etc/security/limits.conf
COPY ".devcontainer/scripts/" /scripts/
COPY ".devcontainer/scripts/getting-started.sh" /workspaces/getting-started.sh
RUN mkdir -p /home/ubuntu/.bun /home/ubuntu/.config /workspaces/bun && bash /scripts/common-debian.sh && bash /scripts/github.sh && bash /scripts/nice.sh && bash /scripts/zig-env.sh
COPY .devcontainer/zls.json /home/ubuntu/.config/zls.json


FROM release