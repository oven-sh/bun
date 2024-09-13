FROM ubuntu:22.04
RUN apt update && \
    apt install -y python3 pip curl git unzip wget ccache ninja-build cargo nodejs && \
    python3 -m pip install --upgrade pip && \
    python3 -m pip install cmake && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun && \
    git clone https://github.com/oven-sh/bun.git
RUN apt install -y lsb-release wget software-properties-common gnupg
RUN wget https://apt.llvm.org/llvm.sh -O - | bash -s -- 16 all
WORKDIR /bun
# RUN apt update && \
#     apt install -y curl wget lsb-release software-properties-common cargo ccache cmake git golang libtool ninja-build pkg-config rustc ruby-full xz-utils && \
#     wget https://apt.llvm.org/llvm.sh -O - | bash -s -- 16 all && \
#     curl -fsSL https://bun.sh/install | bash && \
#     ln -s /root/.bun/bin/bun /usr/local/bin/bun


# WORKDIR /bun


# 1  ls
#    2  bun run build
#    3  apt update
#    4  apt install build-essential libtool autoconf unzip wget
#    5  bun run build
#    6  version=3.28
#    7  build=1
#    8  ## don't modify from here
#    9  mkdir ~/temp
#   10  cd ~/temp
#   11  wget https://cmake.org/files/v$version/cmake-$version.$build.tar.gz
#   12  tar -xzvf cmake-$version.$build.tar.gz
#   13  cd cmake-$version.$build/
#   14  ./bootstrap
#   15  make -j$(nproc)
#   16  apt install -y libssl-dev
#   17  make -j$(nproc)
#   18  ./bootstrap
#   19  nproc
#   20  make -j$(nproc)
#   21  make install
#   22  cmake --version
#   23  cd /bun
#   24  bun run build
#   25  build/bun-debug
#   26  ls
#   27  cd build
#   28  ls
#   29  ls -la
#   30  cd debug
#   31  ls
#   32  ls -la
#   33  ./bun-debug
#   34  ./bun-debug -version
#   35  cd ../..
#   36  bun-debug
#   37  ./bun-debug
#   38  ./build/debug/bun-debug test cli/install/registry
#   39  ./build/debug/bun-debug test cli/install/registry > test.log
#   40  ls -la
#   41  rmdir .npmrc
#   42  ls -la
#   43  cat .npmc
