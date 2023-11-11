FROM mcr.microsoft.com/vscode/devcontainers/base:bullseye

ARG BUN_VERSION="1.0.11"
ARG NODE_VERSION="20"
ARG LLVM_VERSION="16"
ARG ZIG_VERSION="0.12.0-dev.1297+a9e66ed73"
ARG CMAKE_VERSION="3.27.7"
ARG TARGETARCH

ENV TARGETARCH=${TARGETARCH}
ENV NODE_VERSION=${NODE_VERSION}
ENV LLVM_VERSION=${LLVM_VERSION}
ENV ZIG_VERSION=${ZIG_VERSION}
ENV CMAKE_VERSION=${CMAKE_VERSION}

USER vscode

ADD scripts/ /tmp/build-scripts

RUN /tmp/build-scripts/setup-first.sh 
RUN /tmp/build-scripts/setup-llvm.sh
RUN /tmp/build-scripts/setup-nodejs.sh
RUN /tmp/build-scripts/setup-cmake.sh
RUN /tmp/build-scripts/setup-zig.sh

RUN /tmp/build-scripts/setup-bun.sh
RUN /tmp/build-scripts/setup-rust.sh
