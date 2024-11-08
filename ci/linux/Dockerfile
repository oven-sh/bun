ARG IMAGE=debian:11
FROM $IMAGE
COPY ./scripts/bootstrap.sh /tmp/bootstrap.sh
ENV CI=true
RUN sh /tmp/bootstrap.sh && rm -rf /tmp/*
WORKDIR /workspace/bun
COPY bunfig.toml bunfig.toml
COPY package.json package.json
COPY CMakeLists.txt CMakeLists.txt
COPY cmake/ cmake/
COPY scripts/ scripts/
COPY patches/ patches/
COPY *.zig ./
COPY src/ src/
COPY packages/ packages/
COPY test/ test/
RUN bun i
RUN bun run build:ci
