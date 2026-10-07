FROM alpine:3.24 AS build

# https://github.com/oven-sh/bun/releases
ARG BUN_VERSION=latest

# The signing key is inlined so that a keyserver outage cannot fail the build.
# --assert-signer fails if --output is the signature's name without ".asc", hence ".verified.txt".
RUN apk --no-cache add ca-certificates curl gpg gpg-agent unzip \
    && arch="$(apk --print-arch)" \
    && case "${arch##*-}" in \
      x86_64) build="x64-musl-baseline";; \
      aarch64) build="aarch64-musl";; \
      *) echo "error: unsupported architecture: $arch"; exit 1 ;; \
    esac \
    && version="$BUN_VERSION" \
    && case "$version" in \
      latest | canary | bun-v*) tag="$version"; ;; \
      v*)                       tag="bun-$version"; ;; \
      *)                        tag="bun-v$version"; ;; \
    esac \
    && case "$tag" in \
      latest) release="latest/download"; ;; \
      *)      release="download/$tag"; ;; \
    esac \
    && curl "https://github.com/oven-sh/bun/releases/$release/bun-linux-$build.zip" \
      -fsSLO \
      --compressed \
      --retry 5 \
      || (echo "error: failed to download: $tag" && exit 1) \
    && printf '%s\n' \
      '-----BEGIN PGP PUBLIC KEY BLOCK-----' \
      '' \
      'mDMEY9GQFhYJKwYBBAHaRw8BAQdAkppAqaXl0RkROz6NfdvlwYd2UuUVfHLk2NNY' \
      'IzEdnT+0GVJvYm9idW4gPHJvYm9idW5Ab3Zlbi5zaD6IkwQTFgoAOxYhBPPcwIqF' \
      'csB0mz4YiI6rTUCnsitZBQJj0ZAWAhsDBQsJCAcCAiICBhUKCQgLAgQWAgMBAh4H' \
      'AheAAAoJEI6rTUCnsitZ96UBAMvwCLD6Ud1RZkpvvnGUU+idHt2hcNmYU2d0XxDI' \
      'HQ0rAQCA9VFOtjZefQkfhDzgIgnEEdSFXaMiyY+D+LP8awNMCrg4BGPRkBYSCisG' \
      'AQQBl1UBBQEBB0BpfePYSOEx8PihYkNXjlK5YT89CGHjEK5etleaB9i6OwMBCAeI' \
      'eAQYFgoAIBYhBPPcwIqFcsB0mz4YiI6rTUCnsitZBQJj0ZAWAhsMAAoJEI6rTUCn' \
      'sitZvhAA/j4SQxOCLheRG86A2181WAP4qLS1qxSw+fCf28DgiPfbAQCL0kcel+M9' \
      'qbRIlMnwn6TwlQgN9w1qqlSnA9CbKXT9Aw==' \
      '=dGV6' \
      '-----END PGP PUBLIC KEY BLOCK-----' \
      | gpg --batch --import \
    && curl "https://github.com/oven-sh/bun/releases/$release/SHASUMS256.txt.asc" \
      -fsSLO \
      --compressed \
      --retry 5 \
    && gpg --batch --assert-signer F3DCC08A8572C0749B3E18888EAB4D40A7B22B59 \
      --verify --output SHASUMS256.verified.txt SHASUMS256.txt.asc \
      || (echo "error: failed to verify: $tag" && exit 1) \
    && grep " bun-linux-$build.zip\$" SHASUMS256.verified.txt | sha256sum -c - \
      || (echo "error: failed to verify: $tag" && exit 1) \
    && unzip "bun-linux-$build.zip" \
    && mv "bun-linux-$build/bun" /usr/local/bin/bun \
    && rm -f "bun-linux-$build.zip" SHASUMS256.txt.asc SHASUMS256.verified.txt \
    && chmod +x /usr/local/bin/bun

FROM alpine:3.24

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}

# Ensure `bun install -g` works
ARG BUN_INSTALL_BIN=/usr/local/bin
ENV BUN_INSTALL_BIN=${BUN_INSTALL_BIN}

COPY --from=build /usr/local/bin/bun /usr/local/bin/
COPY docker-entrypoint.sh /usr/local/bin/
RUN mkdir -p /usr/local/bun-node-fallback-bin && ln -s /usr/local/bin/bun /usr/local/bun-node-fallback-bin/node
ENV PATH "${PATH}:/usr/local/bun-node-fallback-bin"

# Temporarily use the `build`-stage /tmp folder to access the glibc APKs:
RUN --mount=type=bind,from=build,source=/tmp,target=/tmp \
    addgroup -g 1000 bun \
    && adduser -u 1000 -G bun -s /bin/sh -D bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && apk add libgcc libstdc++ \
    && which bun \
    && which bunx \
    && bun --version

WORKDIR /home/bun/app
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/usr/local/bin/bun"]
