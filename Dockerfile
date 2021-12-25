FROM ubuntu:20.04 as base
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

ENV PATH "/home/ubuntu/zig:$PATH"
ENV JSC_BASE_DIR $WEBKIT_OUT_DIR
ENV LIB_ICU_PATH /home/ubuntu/icu/source/lib
ENV BUN_RELEASE_DIR /home/ubuntu/bun-release
ENV BUN_DEPS_OUT_DIR /home/ubuntu/bun-deps

RUN mkdir -p $BUN_RELEASE_DIR $BUN_DEPS_OUT_DIR /home/ubuntu/bun

FROM base as base_with_zig_and_webkit

WORKDIR /home/ubuntu

RUN curl -L https://github.com/Jarred-Sumner/WebKit/releases/download/Bun-v0/bun-webkit-linux-$BUILDARCH.tar.gz > bun-webkit-linux-$BUILDARCH.tar.gz; \
    tar -xzf bun-webkit-linux-$BUILDARCH.tar.gz; \
    rm bun-webkit-linux-$BUILDARCH.tar.gz && cat $WEBKIT_OUT_DIR/include/cmakeconfig.h > /dev/null

RUN curl -L https://github.com/unicode-org/icu/releases/download/release-66-1/icu4c-66_1-src.tgz > icu4c-66_1-src.tgz && \
    tar -xzf icu4c-66_1-src.tgz && \
    rm icu4c-66_1-src.tgz && \
    cd icu/source && \
    ./configure --enable-static --disable-shared && \
    make -j$(nproc)


WORKDIR /home/ubuntu/bun

FROM base as mimalloc

WORKDIR /home/ubuntu/bun
COPY Makefile /home/ubuntu/bun/Makefile
COPY src/deps/mimalloc /home/ubuntu/bun/src/deps/mimalloc

RUN make mimalloc

FROM base as zlib

WORKDIR /home/ubuntu/bun
COPY Makefile /home/ubuntu/bun/Makefile
COPY src/deps/zlib /home/ubuntu/bun/src/deps/zlib

RUN make zlib

FROM base as libarchive

WORKDIR /home/ubuntu/bun
COPY Makefile /home/ubuntu/bun/Makefile
COPY src/deps/libarchive /home/ubuntu/bun/src/deps/libarchive

RUN make libarchive

FROM base as boringssl

WORKDIR /home/ubuntu/bun
COPY Makefile /home/ubuntu/bun/Makefile
COPY src/deps/boringssl /home/ubuntu/bun/src/deps/boringssl

RUN make boringssl

FROM base as picohttp

WORKDIR /home/ubuntu/bun
COPY Makefile /home/ubuntu/bun/Makefile
COPY src/deps/picohttpparser /home/ubuntu/bun/src/deps/picohttpparser
COPY src/deps/*.c /home/ubuntu/bun/src/deps
COPY src/deps/*.h /home/ubuntu/bun/src/deps

RUN make picohttp

FROM base_with_zig_and_webkit as identifier_cache

WORKDIR /home/ubuntu/bun
COPY Makefile /home/ubuntu/bun/Makefile
COPY src/js_lexer/identifier_data.zig /home/ubuntu/bun/src/js_lexer/identifier_data.zig
COPY src/js_lexer/identifier_cache.zig /home/ubuntu/bun/src/js_lexer/identifier_cache.zig

RUN make identifier-cache

FROM base as node_fallbacks

WORKDIR /home/ubuntu/bun
COPY Makefile /home/ubuntu/bun/Makefile
COPY src/node-fallbacks /home/ubuntu/bun/src/node-fallbacks
RUN make node-fallbacks

FROM base_with_zig_and_webkit as build_dependencies

WORKDIR /home/ubuntu/bun

ENV BUN_DEPS_OUT_DIR /home/ubuntu/bun-deps

COPY ./src /home/ubuntu/bun/src
COPY ./build.zig /home/ubuntu/bun/build.zig
COPY ./completions /home/ubuntu/bun/completions
COPY ./packages /home/ubuntu/bun/packages
COPY ./build-id /home/ubuntu/bun/build-id
COPY ./package.json /home/ubuntu/bun/package.json
COPY ./misctools /home/ubuntu/bun/misctools
COPY Makefile /home/ubuntu/bun/Makefile

COPY --from=mimalloc /home/ubuntu/bun-deps/*.o /home/ubuntu/bun-deps
COPY --from=libarchive /home/ubuntu/bun-deps/*.a /home/ubuntu/bun-deps
COPY --from=picohttp /home/ubuntu/bun-deps/*.o /home/ubuntu/bun-deps
COPY --from=boringssl /home/ubuntu/bun-deps/*.a /home/ubuntu/bun-deps
COPY --from=zlib /home/ubuntu/bun-deps/*.a /home/ubuntu/bun-deps
COPY --from=node_fallbacks /home/ubuntu/bun/src/node-fallbacks /home/ubuntu/bun/src/node-fallbacks
COPY --from=identifier_cache /home/ubuntu/bun/src/js_lexer/*.blob /home/ubuntu/bun/src/js_lexer/

RUN make \
    jsc-bindings-headers \
    api \
    analytics \
    bun_error \
    fallback_decoder 

FROM build_dependencies as build_release 

WORKDIR /home/ubuntu/bun

ENV BUN_RELEASE_DIR /home/ubuntu/bun-release

RUN mkdir -p $BUN_RELEASE_DIR; make release \
    copy-to-bun-release-dir

FROM base_with_zig_and_webkit as bun.devcontainer

ENV WEBKIT_OUT_DIR /home/ubuntu/bun-webkit
ENV PATH "/home/ubuntu/zig:$PATH"
ENV JSC_BASE_DIR $WEBKIT_OUT_DIR
ENV LIB_ICU_PATH /home/ubuntu/icu/source/lib
ENV BUN_RELEASE_DIR /home/ubuntu/bun-release
ENV PATH "/workspaces/bun/packages/bun-linux-x64:/workspaces/bun/packages/bun-linux-aarch64:/workspaces/bun/packages/debug-bun-linux-x64:/workspaces/bun/packages/debug-bun-linux-aarch64:$PATH"
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

FROM ubuntu:20.04 as test_base

ARG DEBIAN_FRONTEND=noninteractive
ENV DEBIAN_FRONTEND=noninteractive

ENV CI 1
ENV NPM_CLIENT bun
ENV PATH "/home/ubuntu/bun/packages/bun-linux-x64:/home/ubuntu/bun/packages/bun-linux-aarch64:$PATH"

# All this is necessary because Ubuntu decided to use snap for their Chromium packages
# Which breaks using Chrome in the container on aarch64
RUN apt-get update && \
    apt-get install -y wget gnupg2 curl make git unzip nodejs npm psmisc && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys DCC9EFBF77E11517 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 648ACFD622F3D138 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys AA8E81B4331F7F50 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 112695A0E562B32A

COPY ./integration /home/ubuntu/bun/integration
COPY Makefile /home/ubuntu/bun/Makefile
COPY package.json /home/ubuntu/bun/package.json

# We don't want to worry about architecture differences in this image
COPY --from=release /opt/bun/bin/bun /home/ubuntu/bun/packages/bun-linux-aarch64/bun
COPY --from=release /opt/bun/bin/bun /home/ubuntu/bun/packages/bun-linux-x64/bun

FROM test_base as test_create_next

WORKDIR /home/ubuntu/bun
CMD make test-create-next

FROM test_base as test_create_react

WORKDIR /home/ubuntu/bun
CMD make test-create-react


FROM test_base as test_bun_run

WORKDIR /home/ubuntu/bun
CMD make test-bun-run

FROM test_base as browser_test_base

COPY .docker/chromium.pref /etc/apt/preferences.d/chromium.pref
COPY .docker/debian.list /etc/apt/sources.list.d/debian.list

RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium


WORKDIR /home/ubuntu/bun

RUN mkdir -p /var/run/dbus && ln -s /usr/bin/chromium /usr/bin/chromium-browser
RUN apt-get install -y make fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 xvfb ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils --no-install-recommends


FROM browser_test_base as test_hmr

WORKDIR /home/ubuntu/bun
CMD dbus-daemon --system &> /dev/null && \
    bun install --cwd /home/ubuntu/bun/integration/snippets && \
    bun install --cwd /home/ubuntu/bun/integration/scripts && \
    bun install && \
    make test-hmr-hmr

FROM browser_test_base as test_no_hmr

WORKDIR /home/ubuntu/bun
CMD dbus-daemon --system &> /dev/null && \
    bun install --cwd /home/ubuntu/bun/integration/snippets && \
    bun install --cwd /home/ubuntu/bun/integration/scripts && \
    bun install && \
    make test-no-hmr

FROM ubuntu:20.04 as release 

COPY --from=build_release /home/ubuntu/bun-release/bun /opt/bun/bin/bun
COPY .devcontainer/limits.conf /etc/security/limits.conf

ENV BUN_INSTALL /opt/bun
ENV PATH "/opt/bun/bin:$PATH"

LABEL org.opencontainers.image.title="Bun ${BUILDARCH} (glibc)"
LABEL org.opencontainers.image.source=https://github.com/jarred-sumner/bun