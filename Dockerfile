
FROM bunbunbunbun/bun-base:latest as lolhtml

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/lol-html ${BUN_DIR}/src/deps/lol-html

RUN cd ${BUN_DIR} && \
    make lolhtml && rm -rf src/deps/lol-html Makefile

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

FROM bunbunbunbun/bun-base:latest as libbacktrace

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/libbacktrace ${BUN_DIR}/src/deps/libbacktrace

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
    make libbacktrace && rm -rf src/deps/libbacktrace Makefile

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

FROM bunbunbunbun/bun-base:latest as uws

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile
COPY src/deps/uws ${BUN_DIR}/src/deps/uws

WORKDIR $BUN_DIR

RUN cd $BUN_DIR && \
    make uws && rm -rf src/deps/uws Makefile

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

FROM bunbunbunbun/bun-base-with-zig-and-webkit:latest as prepare_release

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

COPY --from=lolhtml ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=mimalloc ${BUN_DEPS_OUT_DIR}/*.o ${BUN_DEPS_OUT_DIR}/
COPY --from=libarchive ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=picohttp ${BUN_DEPS_OUT_DIR}/*.o ${BUN_DEPS_OUT_DIR}/
COPY --from=boringssl ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=libbacktrace ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=zlib ${BUN_DEPS_OUT_DIR}/*.a ${BUN_DEPS_OUT_DIR}/
COPY --from=identifier_cache ${BUN_DIR}/src/js_lexer/*.blob ${BUN_DIR}/src/js_lexer
COPY --from=node_fallbacks ${BUN_DIR}/src/node-fallbacks/out ${BUN_DIR}/src/node-fallbacks/out

WORKDIR ${BUN_DIR}


FROM prepare_release as build_release

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

COPY Makefile ${BUN_DIR}/Makefile

WORKDIR $BUN_DIR

RUN cd $BUN_DIR &&  rm -rf $HOME/.cache zig-cache && make \
    jsc-bindings-headers \
    api \
    analytics \
    bun_error \
    fallback_decoder && rm -rf $HOME/.cache zig-cache && \
    mkdir -p $BUN_RELEASE_DIR && \
    make release copy-to-bun-release-dir && \
    rm -rf $HOME/.cache zig-cache misctools package.json build-id completions build.zig $(BUN_DIR)/packages

FROM prepare_release as build_unit

ARG DEBIAN_FRONTEND=noninteractive
ARG GITHUB_WORKSPACE=/build
ARG ZIG_PATH=${GITHUB_WORKSPACE}/zig
# Directory extracts to "bun-webkit"
ARG WEBKIT_DIR=${GITHUB_WORKSPACE}/bun-webkit 
ARG BUN_RELEASE_DIR=${GITHUB_WORKSPACE}/bun-release
ARG BUN_DEPS_OUT_DIR=${GITHUB_WORKSPACE}/bun-deps
ARG BUN_DIR=${GITHUB_WORKSPACE}/bun

WORKDIR $BUN_DIR

ENV PATH "$ZIG_PATH:$PATH"

CMD make jsc-bindings-headers \
    api \
    analytics \
    bun_error \
    fallback_decoder \
    jsc-bindings-mac && \
    make \
    run-all-unit-tests

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
ENV LIB_ICU_PATH ${GITHUB_WORKSPACE}/icu/source/lib
ENV BUN_RELEASE_DIR ${BUN_RELEASE_DIR}
ENV PATH "${GITHUB_WORKSPACE}/packages/bun-linux-x64:${GITHUB_WORKSPACE}/packages/bun-linux-aarch64:${GITHUB_WORKSPACE}/packages/debug-bun-linux-x64:${GITHUB_WORKSPACE}/packages/debug-bun-linux-aarch64:$PATH"
ENV PATH "/home/ubuntu/zls/zig-out/bin:$PATH"

ENV BUN_INSTALL /home/ubuntu/.bun
ENV XDG_CONFIG_HOME /home/ubuntu/.config

RUN apt-get -y update && update-alternatives --install /usr/bin/lldb lldb /usr/bin/lldb-13 90

COPY .devcontainer/workspace.code-workspace $GITHUB_WORKSPACE/workspace.code-workspace
COPY .devcontainer/zls.json $GITHUB_WORKSPACE/workspace.code-workspace
COPY .devcontainer/limits.conf /etc/security/limits.conf
COPY ".devcontainer/scripts/" /scripts/
COPY ".devcontainer/scripts/getting-started.sh" $GITHUB_WORKSPACE/getting-started.sh
RUN mkdir -p /home/ubuntu/.bun /home/ubuntu/.config $GITHUB_WORKSPACE/bun && \
    bash /scripts/common-debian.sh && \
    bash /scripts/github.sh && \
    bash /scripts/nice.sh && \
    bash /scripts/zig-env.sh
COPY .devcontainer/zls.json /home/ubuntu/.config/zls.json

FROM ubuntu:20.04 as release_with_debug_info

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
LABEL org.opencontainers.image.title="bun ${BUILDARCH} (glibc)"
LABEL org.opencontainers.image.source=https://github.com/jarred-sumner/bun
COPY --from=build_release ${BUN_RELEASE_DIR}/bun /opt/bun/bin/bun
COPY --from=build_release ${BUN_RELEASE_DIR}/bun-profile /opt/bun/bin/bun-profile

WORKDIR /opt/bun

ENTRYPOINT [ "/opt/bun/bin/bun" ]

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
LABEL org.opencontainers.image.title="bun ${BUILDARCH} (glibc)"
LABEL org.opencontainers.image.source=https://github.com/jarred-sumner/bun
COPY --from=build_release ${BUN_RELEASE_DIR}/bun /opt/bun/bin/bun
WORKDIR /opt/bun

ENTRYPOINT [ "/opt/bun/bin/bun" ]


FROM bunbunbunbun/bun-test-base as test_base

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
ENV BROWSER_EXECUTABLE /usr/bin/chromium

COPY ./integration ${BUN_DIR}/integration
COPY Makefile ${BUN_DIR}/Makefile
COPY package.json ${BUN_DIR}/package.json
COPY .docker/run-test.sh ${BUN_DIR}/run-test.sh
COPY ./bun.lockb ${BUN_DIR}/bun.lockb   

# # We don't want to worry about architecture differences in this image
COPY --from=release /opt/bun/bin/bun ${BUN_DIR}/packages/bun-linux-aarch64/bun
COPY --from=release /opt/bun/bin/bun ${BUN_DIR}/packages/bun-linux-x64/bun

USER root
RUN chgrp -R chromium ${BUN_DIR} && chmod g+rwx ${BUN_DIR} && chown -R chromium:chromium ${BUN_DIR}
USER chromium

CMD [ "bash", "run-test.sh" ]

FROM release