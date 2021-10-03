FROM ubuntu:latest

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
    libicu-dev

RUN update-alternatives --install /usr/bin/ld ld /usr/bin/lld-12 90 && \
    update-alternatives --install /usr/bin/cc cc /usr/bin/clang-12 90 && \
    update-alternatives --install /usr/bin/cpp cpp /usr/bin/clang++-12 90 && \
    update-alternatives --install /usr/bin/c++ c++ /usr/bin/clang++-12 90


ENV CC=clang-12 
ENV CXX=clang++-12

# Compile zig
RUN mkdir -p /home/ubuntu/zig; cd /home/ubuntu; git clone https://github.com/jarred-sumner/zig.git; cd /home/ubuntu/zig && git checkout jarred/zig-sloppy-with-small-structs && cmake . -DCMAKE_BUILD_TYPE=Release && make -j$(nproc)

ENV PATH="/home/ubuntu/zig:$PATH" 

RUN npm install -g esbuild





