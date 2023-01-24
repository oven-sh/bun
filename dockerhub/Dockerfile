ARG GLIBC_RELEASE=2.34-r0


FROM alpine:latest AS base

ARG GLIBC_RELEASE

# prepare environment
WORKDIR /tmp


FROM base AS bun

# get bun
ADD https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip bun-linux-x64.zip
# install bun
RUN unzip bun-linux-x64.zip && \
    mv /tmp/bun-linux-x64/bun /usr/local/bin && \
    rm bun-linux-x64.zip


FROM base AS glibc

# get glibc
ADD https://alpine-pkgs.sgerrand.com/sgerrand.rsa.pub /etc/apk/keys/sgerrand.rsa.pub
ADD https://github.com/sgerrand/alpine-pkg-glibc/releases/download/${GLIBC_RELEASE}/glibc-${GLIBC_RELEASE}.apk /tmp/glibc-${GLIBC_RELEASE}.apk

# install glibc
RUN apk add --no-cache --force-overwrite /tmp/glibc-${GLIBC_RELEASE}.apk && \
    # cleanup
    rm /etc/apk/keys/sgerrand.rsa.pub && \
    rm /tmp/glibc-${GLIBC_RELEASE}.apk


FROM scratch AS image

COPY --from=glibc . .
COPY --from=bun /usr/local/bin/bun /usr/local/bin

# smoke test
RUN bun --version
