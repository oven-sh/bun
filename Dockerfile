FROM bunbunbunbun/bun-base:latest as mimalloc

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/mimalloc ${BUN_DIR}/src/deps/mimalloc

RUN cd ${BUN_DIR} && \
    make mimalloc && rm -rf src/deps/mimalloc Makefile

FROM bunbunbunbun/bun-base:latest as zlib

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/zlib ${BUN_DIR}/src/deps/zlib

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
    make zlib && rm -rf src/deps/zlib Makefile

FROM bunbunbunbun/bun-base:latest as libarchive

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/libarchive ${BUN_DIR}/src/deps/libarchive

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
    make libarchive && rm -rf src/deps/libarchive Makefile

FROM bunbunbunbun/bun-base:latest as boringssl

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/boringssl ${BUN_DIR}/src/deps/boringssl

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
    make boringssl && rm -rf src/deps/boringssl Makefile

FROM bunbunbunbun/bun-base:latest as picohttp

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/picohttpparser ${BUN_DIR}/src/deps/picohttpparser
COPY src/deps/*.c ${BUN_DIR}/src/deps
COPY src/deps/*.h ${BUN_DIR}/src/deps

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
    make picohttp

FROM bunbunbunbun/bun-base-with-zig-and-webkit:latest as identifier_cache

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

WORKDIR $BUN_DIR

COPY Makefile ${BUN_DIR}/Makefile
COPY src/js_lexer/identifier_data.zig ${BUN_DIR}/src/js_lexer/identifier_data.zig
COPY src/js_lexer/identifier_cache.zig ${BUN_DIR}/src/js_lexer/identifier_cache.zig

RUN cd $BUN_DIR && \
    make identifier-cache && rm -rf zig-cache Makefile

FROM bunbunbunbun/bun-base-with-zig-and-webkit:latest as node_fallbacks

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

WORKDIR $BUN_DIR


COPY Makefile ${BUN_DIR}/Makefile
COPY src/node-fallbacks ${BUN_DIR}/src/node-fallbacks
RUN cd $BUN_DIR && \
    make node-fallbacks && rm -rf src/node-fallbacks/node_modules Makefile

FROM bunbunbunbun/bun-base-with-zig-and-webkit:latest as build_release

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun


WORKDIR $BUN_DIR

COPY ./src ${BUN_DIR}/src
COPY ./build.zig ${BUN_DIR}/build.zig
COPY ./completions ${BUN_DIR}/completions
COPY ./packages ${BUN_DIR}/packages
COPY ./build-id ${BUN_DIR}/build-id
COPY ./package.json ${BUN_DIR}/package.json
COPY ./misctools ${BUN_DIR}/misctools
COPY Makefile ${BUN_DIR}/Makefile

COPY --from=mimalloc ${BUN_DEPS_OUT_DIR}/*.o ${BUN_DEPS_OUT_DIR}/
COPY --from=libarchive ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=picohttp ${BUN_DEPS_OUT_DIR}/*.o ${BUN_DEPS_OUT_DIR}/
COPY --from=boringssl ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=zlib ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=identifier_cache ${BUN_DIR}/src/js_lexer/*.blob ${BUN_DIR}/src/js_lexer

RUN cd $BUN_DIR &&  rm -rf $HOME/.cache zig-cache && make \
    jsc-bindings-headers \
    api \
    analytics \
    bun_error \
    fallback_decoder && rm -rf $HOME/.cache zig-cache && \
    mkdir -p $BUN_RELEASE_DIR && \
    make release copy-to-bun-release-dir && \
    rm -rf $HOME/.cache zig-cache misctools package.json build-id completions build.zig

FROM bunbunbunbun/bun-base-with-zig-and-webkit:latest as bun.devcontainer

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun


ENV WEBKIT_OUT_DIR ${WEBKIT_DIR}
ENV PATH "$ZIG_PATH:$PATH"
ENV JSC_BASE_DIR $WEBKIT_OUT_DIR
ENV LIB_ICU_PATH /home/ubuntu/icu/source/lib
ENV BUN_RELEASE_DIR ${BUN_RELEASE_DIR}
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
RUN mkdir -p /home/ubuntu/.bun /home/ubuntu/.config /workspaces/bun && \
    bash /scripts/common-debian.sh && \
    bash /scripts/github.sh && \
    bash /scripts/nice.sh && \
    bash /scripts/zig-env.sh
COPY .devcontainer/zls.json /home/ubuntu/.config/zls.json

FROM ubuntu:20.04 as release 

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun


COPY .devcontainer/limits.conf /etc/security/limits.conf

ENV BUN_INSTALL /opt/bun
ENV PATH "/opt/bun/bin:$PATH"
ARG BUILDARCH=amd64
LABEL org.opencontainers.image.title="Bun ${BUILDARCH} (glibc)"
LABEL org.opencontainers.image.source=https://github.com/jarred-sumner/bun
COPY --from=build_release ${BUN_RELEASE_DIR}/bun /opt/bun/bin/bun
WORKDIR /opt/bun


FROM debian:bullseye-slim as test_base
# Original creator:
# LABEL maintainer "Jessie Frazelle <jess@linux.com>"

# Install Chromium
# Yes, including the Google API Keys sucks but even debian does the same: https://packages.debian.org/stretch/amd64/chromium/filelist
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-l10n \
    fonts-liberation \
    fonts-roboto \
    hicolor-icon-theme \
    libcanberra-gtk-module \
    libexif-dev \
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    libpangox-1.0-0 \
    libv4l-0 \
    fonts-symbola \
    bash \
    make \
    psmisc \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /etc/chromium.d/ \
    && /bin/echo -e 'export GOOGLE_API_KEY="AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k"\nexport GOOGLE_DEFAULT_CLIENT_ID="811574891467.apps.googleusercontent.com"\nexport GOOGLE_DEFAULT_CLIENT_SECRET="kdloedMFGdGla2P1zacGjAQh"' > /etc/chromium.d/googleapikeys 


ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

ARG BUILDARCH=amd64
RUN groupadd -r chromium && useradd   -d  ${BUN_DIR} -M -r -g chromium -G audio,video chromium \
    && mkdir -p /home/chromium/Downloads && chown -R chromium:chromium /home/chromium

USER chromium
WORKDIR $BUN_DIR

ENV NPM_CLIENT bun
ENV PATH "${BUN_DIR}/packages/bun-linux-x64:${BUN_DIR}/packages/bun-linux-aarch64:$PATH"
ENV CI 1
ENV BROWSER_EXECUTABLE /usr/bin/chromium-browser

COPY ./integration ${BUN_DIR}/integration
COPY Makefile ${BUN_DIR}/Makefile
COPY package.json ${BUN_DIR}/package.json
COPY run-test.sh ${BUN_DIR}/run-test.sh
COPY ./bun.lockb ${BUN_DIR}/bun.lockb   

# # We don't want to worry about architecture differences in this image
COPY --from=release /opt/bun/bin ${BUN_DIR}/packages/bun-linux-aarch64/bun/
COPY --from=release /opt/bun/bin ${BUN_DIR}/packages/bun-linux-x64/bun/

USER root
RUN chgrp -R chromium ${BUN_DIR} && chmod g+rwx ${BUN_DIR} && chown -R chromium:chromium ${BUN_DIR}
USER chromium

CMD [ "bash", "run-test.sh" ]

FROM release