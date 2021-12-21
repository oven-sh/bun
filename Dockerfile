# This builds bun in release mode
FROM ubuntu:20.04
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install --no-install-recommends -y wget gnupg2 curl lsb-release wget software-properties-common
RUN curl -s https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -

RUN wget https://apt.llvm.org/llvm.sh --no-check-certificate
RUN chmod +x llvm.sh
RUN ./llvm.sh 12

RUN apt-get update && apt-get install --no-install-recommends -y \
    ca-certificates \
    curl \
    gnupg2 \
    software-properties-common \
    cmake \
    build-essential \
    git \
    libssl-dev \
    ruby \
    liblld-12-dev \
    libclang-12-dev \
    nodejs \
    gcc \
    g++ \
    npm \
    clang-12 \
    clang-format-12 \
    libc++-12-dev \
    libc++abi-12-dev \
    lld-12 \
    libicu-dev \
    wget \
    unzip \
    tar

RUN update-alternatives --install /usr/bin/ld ld /usr/bin/lld-12 90 && \
    update-alternatives --install /usr/bin/cc cc /usr/bin/clang-12 90 && \
    update-alternatives --install /usr/bin/cpp cpp /usr/bin/clang++-12 90 && \
    update-alternatives --install /usr/bin/c++ c++ /usr/bin/clang++-12 90

ENV CC=clang-12 
ENV CXX=clang++-12

WORKDIR /home/ubuntu
ARG BUILDARCH
ENV ARCH "$BUILDARCH"


RUN npm install -g esbuild

RUN wget https://github.com/Jarred-Sumner/zig/releases/download/dec20/zig-linux-$ARCH.zip; \
    unzip zig-linux-$ARCH.zip; \
    rm zig-linux-$ARCH.zip;


ENV WEBKIT_OUT_DIR /home/ubuntu/bun-webkit

WORKDIR /home/ubuntu
RUN wget https://github.com/Jarred-Sumner/WebKit/releases/download/Bun-v0/bun-webkit-linux-$ARCH.tar.gz; \
    tar -xzvf bun-webkit-linux-$ARCH.tar.gz; \
    rm bun-webkit-linux-$ARCH.tar.gz && cat $WEBKIT_OUT_DIR/include/cmakeconfig.h > /dev/null



RUN add-apt-repository ppa:longsleep/golang-backports
RUN apt update
RUN apt install golang-go  chromium-browser --no-install-recommends ninja-build pkg-config automake autoconf libtool -y --no-install-recommends

ADD . /home/ubuntu/bun


WORKDIR /home/ubuntu
RUN wget https://github.com/unicode-org/icu/releases/download/release-66-1/icu4c-66_1-src.tgz && \
    tar -xzf icu4c-66_1-src.tgz && \
    rm icu4c-66_1-src.tgz && \
    cd icu/source && \
    ./configure --enable-static --disable-shared && \
    make -j$(nproc) && \
    cp lib/libicudata.a /home/ubuntu/bun/src/deps && \
    cp lib/libicui18n.a /home/ubuntu/bun/src/deps && \
    cp lib/libicuio.a /home/ubuntu/bun/src/deps && \
    cp lib/libicutu.a /home/ubuntu/bun/src/deps && \
    cp lib/libicuuc.a /home/ubuntu/bun/src/deps

ENV PATH "/home/ubuntu/zig:$PATH"
ENV JSC_BASE_DIR $WEBKIT_OUT_DIR

WORKDIR /home/ubuntu/bun

RUN make api analytics node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp zlib libarchive boringssl picohttp

WORKDIR /home/ubuntu/bun

RUN make jsc-bindings-headers
RUN make jsc-bindings-mac

RUN make identifier-cache
RUN make release