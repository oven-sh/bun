FROM bun-zig:latest

COPY . /home/ubuntu/bun
WORKDIR /home/ubuntu/bun

RUN make vendor-without-check


