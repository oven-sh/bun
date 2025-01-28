FROM alpine:edge
ENV HOME=/root
WORKDIR /root
COPY ./build-alpine/release/bun .
COPY ./test ./test
COPY ./scripts ./scripts
COPY ./package.json ./package.json
COPY ./packages ./packages

RUN apk update
RUN apk add nodejs lsb-release-minimal git python3 npm make g++
RUN apk add file

RUN file /root/bun
RUN ldd /root/bun
RUN /root/bun

RUN ./scripts/runner.node.mjs --exec-path /root/bun

# docker build -f ./ci/alpine/test.Dockerfile --progress=plain .
