FROM debian:trixie-slim AS build

# https://github.com/oven-sh/bun/releases
ARG BUN_VERSION=latest

# The signing key is inlined so that a keyserver outage cannot fail the build.
# --assert-signer fails if --output is the signature's name without ".asc", hence ".verified.txt".
RUN apt-get update -qq \
    && apt-get install -qq --no-install-recommends \
      ca-certificates \
      curl \
      gpg \
      gpg-agent \
      unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && arch="$(dpkg --print-architecture)" \
    && case "${arch##*-}" in \
      amd64) build="x64-baseline";; \
      arm64) build="aarch64";; \
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
    && chmod +x /usr/local/bin/bun \
    && which bun \
    && bun --version

FROM gcr.io/distroless/base-nossl-debian13

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}

# Ensure `bun install -g` works
ARG BUN_INSTALL_BIN=/usr/local/bin
ENV BUN_INSTALL_BIN=${BUN_INSTALL_BIN}

COPY --from=build /usr/local/bin/bun /usr/local/bin/
ENV PATH "${PATH}:/usr/local/bun-node-fallback-bin"

# Temporarily use the `build`-stage image binaries to create a symlink:
RUN --mount=type=bind,from=build,source=/usr/bin,target=/usr/bin \
    --mount=type=bind,from=build,source=/etc/alternatives/which,target=/etc/alternatives/which \
    --mount=type=bind,from=build,source=/bin,target=/bin \
    --mount=type=bind,from=build,source=/usr/lib,target=/usr/lib \
    --mount=type=bind,from=build,source=/lib,target=/lib \
    <<EOF
  ln -s /usr/local/bin/bun /usr/local/bin/bunx
  which bunx
  mkdir -p /usr/local/bun-node-fallback-bin
  ln -s /usr/local/bin/bun /usr/local/bun-node-fallback-bin/nodebun
EOF

ENTRYPOINT ["/usr/local/bin/bun"]
