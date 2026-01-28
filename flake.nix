{
  description = "Bun - A fast all-in-one JavaScript runtime";

  # Uncomment this when you set up Cachix to enable automatic binary cache
  # nixConfig = {
  #   extra-substituters = [
  #     "https://bun-dev.cachix.org"
  #   ];
  #   extra-trusted-public-keys = [
  #     "bun-dev.cachix.org-1:REPLACE_WITH_YOUR_PUBLIC_KEY"
  #   ];
  # };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };

        # LLVM 19 - matching the bootstrap script (targets 19.1.7, actual version from nixpkgs-unstable)
        llvm = pkgs.llvm_19;
        clang = pkgs.clang_19;
        lld = pkgs.lld_19;

        # Node.js 24 - matching the bootstrap script (targets 24.3.0, actual version from nixpkgs-unstable)
        nodejs = pkgs.nodejs_24;

        # Build tools and dependencies
        packages = [
          # Core build tools
          pkgs.cmake # Expected: 3.30+ on nixos-unstable as of 2025-10
          pkgs.ninja
          pkgs.pkg-config
          pkgs.ccache

          # Compilers and toolchain - version pinned to LLVM 19
          clang
          llvm
          lld
          pkgs.gcc
          pkgs.rustc
          pkgs.cargo
          pkgs.go

          # Bun itself (for running build scripts via `bun bd`)
          pkgs.bun

          # Node.js - version pinned to 24
          nodejs

          # Python for build scripts
          pkgs.python3

          # Other build dependencies from bootstrap.sh
          pkgs.libtool
          pkgs.ruby
          pkgs.perl

          # Libraries
          pkgs.openssl
          pkgs.zlib
          pkgs.libxml2
          pkgs.libiconv

          # Development tools
          pkgs.git
          pkgs.curl
          pkgs.wget
          pkgs.unzip
          pkgs.xz

          # Additional dependencies for Linux
        ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
          pkgs.gdb # for debugging core dumps (from bootstrap.sh line 1535)

          # Chromium dependencies for Puppeteer testing (from bootstrap.sh lines 1397-1483)
          # X11 and graphics libraries
          pkgs.xorg.libX11
          pkgs.xorg.libxcb
          pkgs.xorg.libXcomposite
          pkgs.xorg.libXcursor
          pkgs.xorg.libXdamage
          pkgs.xorg.libXext
          pkgs.xorg.libXfixes
          pkgs.xorg.libXi
          pkgs.xorg.libXrandr
          pkgs.xorg.libXrender
          pkgs.xorg.libXScrnSaver
          pkgs.xorg.libXtst
          pkgs.libxkbcommon
          pkgs.mesa
          pkgs.nspr
          pkgs.nss
          pkgs.cups
          pkgs.dbus
          pkgs.expat
          pkgs.fontconfig
          pkgs.freetype
          pkgs.glib
          pkgs.gtk3
          pkgs.pango
          pkgs.cairo
          pkgs.alsa-lib
          pkgs.at-spi2-atk
          pkgs.at-spi2-core
          pkgs.libgbm # for hardware acceleration
          pkgs.liberation_ttf # fonts-liberation
          pkgs.atk
          pkgs.libdrm
          pkgs.xorg.libxshmfence
          pkgs.gdk-pixbuf
        ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
          # macOS specific dependencies
          pkgs.darwin.apple_sdk.frameworks.CoreFoundation
          pkgs.darwin.apple_sdk.frameworks.CoreServices
          pkgs.darwin.apple_sdk.frameworks.Security
        ];

      in
      {
        devShells.default = (pkgs.mkShell.override {
          stdenv = pkgs.clangStdenv;
        }) {
          inherit packages;
          hardeningDisable = [ "fortify" ];

          shellHook = ''
            # Set up build environment
            export CC="${pkgs.lib.getExe clang}"
            export CXX="${pkgs.lib.getExe' clang "clang++"}"
            export AR="${llvm}/bin/llvm-ar"
            export RANLIB="${llvm}/bin/llvm-ranlib"
            export CMAKE_C_COMPILER="$CC"
            export CMAKE_CXX_COMPILER="$CXX"
            export CMAKE_AR="$AR"
            export CMAKE_RANLIB="$RANLIB"
            export CMAKE_SYSTEM_PROCESSOR="$(uname -m)"
            export TMPDIR="''${TMPDIR:-/tmp}"
          '' + pkgs.lib.optionalString pkgs.stdenv.isLinux ''
            export LD="${pkgs.lib.getExe' lld "ld.lld"}"
            export NIX_CFLAGS_LINK="''${NIX_CFLAGS_LINK:+$NIX_CFLAGS_LINK }-fuse-ld=lld"
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath packages}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          '' + ''

            # Print welcome message
            echo "====================================="
            echo "Bun Development Environment"
            echo "====================================="
            echo "Node.js: $(node --version 2>/dev/null || echo 'not found')"
            echo "Bun: $(bun --version 2>/dev/null || echo 'not found')"
            echo "Clang: $(clang --version 2>/dev/null | head -n1 || echo 'not found')"
            echo "CMake: $(cmake --version 2>/dev/null | head -n1 || echo 'not found')"
            echo "LLVM: ${llvm.version}"
            echo ""
            echo "Quick start:"
            echo "  bun bd                    # Build debug binary"
            echo "  bun bd test <test-file>   # Run tests"
            echo "====================================="
          '';

          # Additional environment variables
          CMAKE_BUILD_TYPE = "Debug";
          ENABLE_CCACHE = "1";
        };
      }
    );
}
