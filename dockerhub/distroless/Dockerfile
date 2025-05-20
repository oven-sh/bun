FROM debian:bullseye-slim AS build

ARG  BUN_VERSION=latest

RUN apt-get update -qq && \
    apt-get install -qq --no-install-recommends \
        ca-certificates curl dirmngr gpg gpg-agent unzip && \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "${arch##*-}" in \
        amd64) build="x64-baseline" ;; \
        arm64) build="aarch64" ;; \
        *) echo "Unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    tag="$BUN_VERSION"; \
    case "$tag" in \
        latest | canary | bun-v*) ;; \
        v*)  tag="bun-$tag" ;; \
        *)   tag="bun-v$tag" ;; \
    esac; \
    release="download/$tag"; \
    [ "$tag" = "latest" ] && release="latest/download"; \
    curl -fsSLo bun.zip \
         "https://github.com/oven-sh/bun/releases/$release/bun-linux-$build.zip" \
         --retry 5 --compressed; \
    curl -fsSLo SHASUMS256.txt.asc \
         "https://github.com/oven-sh/bun/releases/$release/SHASUMS256.txt.asc" \
         --retry 5 --compressed; \
    gpg --batch --keyserver hkps://keys.openpgp.org \
        --recv-keys F3DCC08A8572C0749B3E18888EAB4D40A7B22B59 || \
    gpg --batch --keyserver keyserver.ubuntu.com \
        --recv-keys F3DCC08A8572C0749B3E18888EAB4D40A7B22B59; \
    gpg --batch --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc; \
    grep " bun-linux-$build.zip\$" SHASUMS256.txt | sha256sum -c -; \
    unzip bun.zip; \
    mv bun-linux-$build/bun /usr/local/bin/bun; \
    chmod +x /usr/local/bin/bun; \
    ln -s /usr/local/bin/bun /usr/local/bin/bunx; \
    mkdir -p /usr/local/bun-node-fallback-bin; \
    ln -s /usr/local/bin/bun /usr/local/bun-node-fallback-bin/nodebun; \
    bun --version

FROM gcr.io/distroless/base-nossl-debian11

ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    BUN_INSTALL_BIN=/usr/local/bin \
    PATH="/usr/local/bun-node-fallback-bin:${PATH}"

COPY --from=build /usr/local/bin/bun    /usr/local/bin/bun
COPY --from=build /usr/local/bin/bunx   /usr/local/bin/bunx
COPY --from=build /usr/local/bun-node-fallback-bin /usr/local/bun-node-fallback-bin

ENTRYPOINT ["/usr/local/bin/bun"]
