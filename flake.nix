{
  description = "Bun flake and build environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        olderBunVersion = {
          x64 = {
            dir = "bun-linux-x64";
            url = "https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/bun-v1.1.38/bun-linux-x64.zip";
            sha256 = "sha256-e5OtTccoPG7xKQVvZiuvo3VSBC8mRteOj1d0GF+nEtk=";
            
          };
          arm64 = {
            dir = "bun-linux-aarch64";
            url = "https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/bun-v1.1.38/bun-linux-aarch64.zip";
            sha256 = "sha256-iE+uoF4+18shNqlPM19WfbqXwxC2CG72RS8++KGXkH4=";
          };
        };
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
          config = {
            allowUnfree = true;
          };
        };

        # Function to create a derivation for downloading Bun binary
        getBunBinary = arch: pkgs.runCommand "bun-binary-${arch}" {} ''
          mkdir -p $out/bin
          cp ${pkgs.fetchzip {
            name = "bun-binary-${arch}";
            url = olderBunVersion.${arch}.url;
            stripRoot = false;
            sha256 = olderBunVersion.${arch}.sha256;
          }}/${olderBunVersion.${arch}.dir}/bun $out/bin/bun
          chmod +x $out/bin/bun
        '';

        # Function to create build environment for a specific architecture
        makeBuildEnv = arch: pkgs.buildEnv {
          name = "bun-build-tools-${arch}";
          paths = with pkgs; [
            # Core build tools
            bash
            coreutils
            gcc13
            # Full LLVM 18 toolchain
            llvmPackages_18.llvm
            llvmPackages_18.clang
            llvmPackages_18.lld
            llvmPackages_18.lldb
            llvmPackages_18.bintools
            cmake
            ninja
            pkg-config
            gnumake
            binutils
            file

            # Languages needed for build
            nodejs_22
            python3
            go
            (rust-bin.stable.latest.default.override {
              extensions = [ "rust-src" "rust-analysis" ];
            })
            (perl.withPackages (p: with p; [
              MathBigInt
              JSON
              DataDumper
              FileSlurp
            ]))

            # Development tools
            git
            curl
            wget
            unzip
            xz
            ccache

            # SSL Certificates
            cacert

            # Libraries
            zlib
            openssl
            libffi

            # Include the Bun binary
            (getBunBinary arch)
          ];

          pathsToLink = [ "/bin" "/lib" "/lib64" "/include" "/share" "/etc/ssl" ];
          extraOutputsToInstall = [ "dev" "out" "bin" ];
          ignoreCollisions = true;
        };

        # Create both x64 and arm64 environments
        buildEnvX64 = makeBuildEnv "x64";
        buildEnvArm64 = makeBuildEnv "arm64";

        # Function to build Bun for release
        buildBun = arch: pkgs.stdenv.mkDerivation {
          pname = "bun";
          version = "latest";
          
          src = ./.;

          nativeBuildInputs = [
            (if arch == "x64" then buildEnvX64 else buildEnvArm64)
          ];

          buildPhase = ''
            export HOME=$TMPDIR
            bun build:release
          '';

          installPhase = ''
            mkdir -p $out/bin
            cp build/release/bun $out/bin/
            chmod +x $out/bin/bun
          '';

          meta = with pkgs.lib; {
            description = "Incredibly fast JavaScript runtime, bundler, transpiler and package manager";
            homepage = "https://bun.sh";
            license = licenses.mit;
            platforms = platforms.linux;
          };
        };

      in
      {
        packages = {
          default = buildEnvX64;
          build-x64 = buildEnvX64;
          build-arm64 = buildEnvArm64;
          x64 = buildBun "x64";
          arm64 = buildBun "arm64";
        };

        devShells = {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
            ];

            shellHook = ''
              echo "To compile a release build of Bun:"
              echo "  bun build:release"
              echo "To compile a debug build of Bun:"
              echo "  bun build:debug"
            '';
          };

          # CI shells for different architectures
          ci-x64 = pkgs.mkShell {
            buildInputs = with pkgs; [
              # Include the x64 build environment tools
              buildEnvX64
            ];
          };

          ci-arm64 = pkgs.mkShell {
            buildInputs = with pkgs; [
              # Include the arm64 build environment tools
              buildEnvArm64
            ];
          };

          # Generic CI shell that defaults to x64
          ci = pkgs.mkShell {
            buildInputs = with pkgs; [
              # Include architecture-specific build environment tools
              (if stdenv.hostPlatform.isAarch64 
               then buildEnvArm64
               else buildEnvX64)
            ];
          };
        };
      });
}