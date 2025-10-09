{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
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
    export CC=clang
    export CXX=clang++
    export CMAKE_SYSTEM_PROCESSOR=$(uname -m)
    export TMPDIR=''${TMPDIR:-/tmp}

    ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
      export LD="${pkgs.lld_19}/bin/lld"
      export LDFLAGS="-fuse-ld=lld"
      export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath buildInputs}:$LD_LIBRARY_PATH"
    ''}

    echo "====================================="
    echo "Bun Development Environment (Nix)"
    echo "====================================="
    echo "To build: bun bd"
    echo "To test:  bun bd test <test-file>"
    echo "====================================="
  '';
}
