{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    cmake
    ninja
    clang_19
    llvm_19
    lld_19
    nodejs_24
    bun
    rustc
    cargo
    go
    python3
    ccache
    pkg-config
    gnumake
    libtool
    ruby
    perl
    openssl
    zlib
    libxml2
    git
    curl
    wget
    unzip
    xz
  ];

  shellHook = ''
    export CC=clang
    export CXX=clang++
    export CMAKE_SYSTEM_PROCESSOR=$(uname -m)
    export TMPDIR=''${TMPDIR:-/tmp}

    echo "====================================="
    echo "Bun Development Environment (Nix)"
    echo "====================================="
    echo "To build: bun bd"
    echo "To test:  bun bd test <test-file>"
    echo "====================================="
  '';
}
