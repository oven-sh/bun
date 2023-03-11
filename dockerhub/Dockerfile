FROM debian:bullseye-slim as base

# prepare environment
WORKDIR /tmp
RUN apt-get update && \
    apt-get install -y unzip && \
    rm -rf /var/lib/apt/lists/*

# get bun
ADD https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip bun-linux-x64.zip
RUN unzip bun-linux-x64.zip

FROM gcr.io/distroless/base-nossl-debian11

# install bun
COPY --from=base /tmp/bun-linux-x64/bun /usr/bin/bun

# default entrypoint
ENTRYPOINT ["/usr/bin/bun"]
