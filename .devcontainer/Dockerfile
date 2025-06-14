FROM fedora:41

# Install packages
RUN dnf install -y \
    cargo \
    ccache \
    cmake \
    git \
    golang \
    libtool \
    ninja-build \
    pkg-config \
    rustc \
    ruby \
    libatomic-static \
    libstdc++-static \
    sed \
    unzip \
    which \
    libicu-devel \
    'perl(Math::BigInt)' \
    llvm \
    clang \
    lld-devel \
    sudo

# Create vscode user
RUN useradd -m -s /bin/bash vscode && echo 'vscode ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Install bun as vscode user
USER vscode
RUN curl -fsSL https://bun.sh/install | bash && sudo ln -s ~/.bun/bin/* /usr/local/bin/

USER root