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
        buildInputs = with pkgs; [
          # Core build tools
          cmake # 3.30+
          ninja
          pkg-config
          gnumake
          ccache

          # Compilers and toolchain
          clang # LLVM 19
          llvm # LLVM 19
          lld # LLVM 19
          gcc
          rustc
          cargo
          go

          # Bun itself (for running build scripts via `bun bd`)
          bun

          # Node.js 24
          nodejs

          # Python for build scripts
          python3

          # Other build dependencies from bootstrap.sh
          libtool
          ruby
          perl

          # Libraries
          openssl
          zlib
          libxml2
          libiconv

          # Development tools
          git
          curl
          wget
          unzip
          xz
          htop
          gnupg

          # Additional dependencies for Linux
        ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
          glibc
          gdb # for debugging core dumps
          # X11 and graphics libraries for Chromium/testing
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
        ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
          # macOS specific dependencies
          darwin.apple_sdk.frameworks.CoreFoundation
          darwin.apple_sdk.frameworks.CoreServices
          darwin.apple_sdk.frameworks.Security
        ];

        # FHS environment for better compatibility on non-NixOS systems
        # This creates a chroot-like environment that looks like a standard Linux system
        fhsEnv = pkgs.buildFHSEnv {
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
        };

      in
      {
        # FHS shell - default for better compatibility on non-NixOS
        devShells.default = fhsEnv.env;

        # Traditional nix shell (for NixOS users or debugging)
        devShells.pure = pkgs.mkShell {
          inherit buildInputs;

          shellHook = ''
            # Set up compiler environment
            export CC="${clang}/bin/clang"
            export CXX="${clang}/bin/clang++"
            export AR="${llvm}/bin/llvm-ar"
            export RANLIB="${llvm}/bin/llvm-ranlib"
            export LD="${lld}/bin/lld"
            export LDFLAGS="-fuse-ld=lld"

            # Ensure proper library paths
            ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
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
            echo ""
            echo "Environment variables set:"
            echo "  CC=${clang}/bin/clang"
            echo "  CXX=${clang}/bin/clang++"
            echo "====================================="
          '';

          # Additional environment variables
          CMAKE_BUILD_TYPE = "Debug";
          ENABLE_CCACHE = "1";

          # Disable analytics for build tools
          HOMEBREW_NO_ANALYTICS = "1";
          HOMEBREW_NO_AUTO_UPDATE = "1";
        };

        # Add a formatter
        formatter = pkgs.nixpkgs-fmt;
      }
    );
}
