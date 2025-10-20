# Simple shell.nix for users without flakes enabled
# For reproducible builds with locked dependencies, use: nix develop
# This uses unpinned <nixpkgs> for simplicity; flake.nix provides version pinning via flake.lock
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell rec {
  packages = with pkgs; [
    # Core build tools (matching bootstrap.sh)
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

    # Libraries
    openssl
    zlib
    libxml2

    # Development tools
    git
    curl
    wget
    unzip
    xz

    # Linux-specific: gdb and Chromium deps for testing
  ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
    gdb
    # Chromium dependencies for Puppeteer tests
    xorg.libX11
    xorg.libxcb
    xorg.libXcomposite
    xorg.libXcursor
    xorg.libXdamage
    xorg.libXext
    xorg.libXfixes
    xorg.libXi
    xorg.libXrandr
    xorg.libXrender
    xorg.libXScrnSaver
    xorg.libXtst
    libxkbcommon
    mesa
    nspr
    nss
    cups
    dbus
    expat
    fontconfig
    freetype
    glib
    gtk3
    pango
    cairo
    alsa-lib
    at-spi2-atk
    at-spi2-core
    libgbm
    liberation_ttf
    atk
    libdrm
    xorg.libxshmfence
    gdk-pixbuf
  ];

  shellHook = ''
    export CC="${pkgs.lib.getExe pkgs.clang_19}"
    export CXX="${pkgs.lib.getExe' pkgs.clang_19 "clang++"}"
    export AR="${pkgs.llvm_19}/bin/llvm-ar"
    export RANLIB="${pkgs.llvm_19}/bin/llvm-ranlib"
    export CMAKE_C_COMPILER="$CC"
    export CMAKE_CXX_COMPILER="$CXX"
    export CMAKE_AR="$AR"
    export CMAKE_RANLIB="$RANLIB"
    export CMAKE_SYSTEM_PROCESSOR=$(uname -m)
    export TMPDIR=''${TMPDIR:-/tmp}
  '' + pkgs.lib.optionalString pkgs.stdenv.isLinux ''
    export LD="${pkgs.lib.getExe' pkgs.lld_19 "ld.lld"}"
    export NIX_CFLAGS_LINK="''${NIX_CFLAGS_LINK:+$NIX_CFLAGS_LINK }-fuse-ld=lld"
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath packages}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  '' + ''

    echo "====================================="
    echo "Bun Development Environment (Nix)"
    echo "====================================="
    echo "To build: bun bd"
    echo "To test:  bun bd test <test-file>"
    echo "====================================="
  '';
}
