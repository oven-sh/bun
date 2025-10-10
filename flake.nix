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

        # LLVM 19 - matching the bootstrap script version (19.1.7)
        llvm = pkgs.llvm_19;
        clang = pkgs.clang_19;
        lld = pkgs.lld_19;

        # Node.js - matching the bootstrap script version (24.3.0)
        nodejs = pkgs.nodejs_24;

        # Build tools and dependencies
        buildInputs = [
          # Core build tools
          pkgs.cmake # Expected: 3.30+ on nixos-unstable as of 2025-10
          pkgs.ninja
          pkgs.pkg-config
          pkgs.gnumake
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
          pkgs.htop
          pkgs.gnupg

          # Additional dependencies for Linux
        ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
          pkgs.glibc
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

        # FHS environment for better compatibility on non-NixOS systems
        # This creates a chroot-like environment that looks like a standard Linux system
        # Only available on Linux (buildFHSEnv asserts stdenv.isLinux)
        fhsEnv =
          if pkgs.stdenv.isLinux then
            pkgs.buildFHSEnv {
              name = "bun-dev-env";
              targetPkgs = pkgs: buildInputs;
              runScript = "bash";
              profile = ''
                # Set up compiler environment
                export CC="${clang}/bin/clang"
                export CXX="${clang}/bin/clang++"
                export AR="${llvm}/bin/llvm-ar"
                export RANLIB="${llvm}/bin/llvm-ranlib"
                export LD="${lld}/bin/lld"
                export LDFLAGS="-fuse-ld=lld"

                # CMake settings
                export CMAKE_BUILD_TYPE="Debug"
                export ENABLE_CCACHE="1"

                # Disable analytics
                export HOMEBREW_NO_ANALYTICS="1"
                export HOMEBREW_NO_AUTO_UPDATE="1"

                echo "====================================="
                echo "Bun Development Environment (FHS)"
                echo "====================================="
                echo "Node.js: $(node --version 2>/dev/null || echo 'not found')"
                echo "Bun: $(bun --version 2>/dev/null || echo 'not found')"
                echo "Clang: $(clang --version 2>/dev/null | head -n1 || echo 'not found')"
                echo "CMake: $(cmake --version 2>/dev/null | head -n1 || echo 'not found')"
                echo ""
                echo "Quick start:"
                echo "  bun bd                    # Build debug binary"
                echo "  bun bd test <test-file>   # Run tests"
                echo "====================================="
              '';
            }
          else
            null;

        pureShell = pkgs.mkShell {
          inherit buildInputs;

          # Use clang as the C/C++ compiler
          stdenv = pkgs.clangStdenv;

          shellHook = ''
            # Set up compiler environment (LLVM 19)
            export CC="${clang}/bin/clang"
            export CXX="${clang}/bin/clang++"
            export AR="${llvm}/bin/llvm-ar"
            export RANLIB="${llvm}/bin/llvm-ranlib"

            # LD/LDFLAGS are Linux-only (macOS uses system linker)
            ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
              export LD="${lld}/bin/lld"
              export LDFLAGS="-fuse-ld=lld"
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath buildInputs}:$LD_LIBRARY_PATH"
            ''}

            # Set up Rust if not already configured
            if [ ! -d "$HOME/.cargo" ]; then
              echo "Note: Rust toolchain will be managed by rustc/cargo from Nix"
            fi

            # Print welcome message
            echo "====================================="
            echo "Bun Development Environment"
            echo "====================================="
            echo "Node.js: $(node --version)"
            echo "Bun: $(bun --version)"
            echo "Clang: $(clang --version | head -n1)"
            echo "CMake: $(cmake --version | head -n1)"
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

          # Disable analytics for build tools
          HOMEBREW_NO_ANALYTICS = "1";
          HOMEBREW_NO_AUTO_UPDATE = "1";
        };
      in
      {
        # Use FHS environment on Linux, pure shell on other platforms
        devShells.default = if pkgs.stdenv.isLinux then fhsEnv.env else pureShell;
        devShells.pure = pureShell;

        # Add a formatter
        formatter = pkgs.nixfmt-rfc-style;
      }
    );
}
