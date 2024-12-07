{
  description = "Bun build environment";

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
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
          config = {
            allowUnfree = true;
            permittedInsecurePackages = [
              "nodejs-16.20.2"
            ];
          };
        };

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
          ];

         
          # Download arm64 binary for linux arm64, x64 binary for linux x64
          preFixup = ''
            ${pkgs.curl}/bin/curl -L "https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/bun-v1.1.38/bun-linux-${arch}.zip"
            unzip $out/bun-linux-${arch}.zip
            cp $out/bun-linux-${arch}/bun $out/bin/bun
            chmod +x $out/bin/bun
            rm -rf $out/bun-linux-${arch} $out/bun-linux-${arch}.zip
          '';

          pathsToLink = [ "/bin" "/lib" "/lib64" "/include" "/share" "/etc/ssl" ];
          extraOutputsToInstall = [ "dev" "out" "bin" ];
          ignoreCollisions = true;
        };

        # Create both x64 and arm64 environments
        buildEnvX64 = makeBuildEnv "x64";
        buildEnvArm64 = makeBuildEnv "arm64";

      in
      {
        packages = {
          default = buildEnvX64;
          x64 = buildEnvX64;
          arm64 = buildEnvArm64;
        };

        devShells = {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              packer
              awscli2
            ];

            shellHook = ''
              echo "Bun build environment tools installed"
              echo "To build AMIs, run: packer build -var 'arch=x64' packer.json"
              echo "                or: packer build -var 'arch=arm64' packer.json"
            '';
          };

          # CI shells for different architectures
          ci-x64 = pkgs.mkShell {
            buildInputs = with pkgs; [
              buildkite-agent
              # Include the x64 build environment tools
              buildEnvX64
            ];

            shellHook = ''
              echo "BuildKite CI environment initialized (x64)"
              
              # Set up BuildKite agent configuration if needed
              if [ -z "$BUILDKITE_AGENT_TOKEN" ]; then
                echo "Warning: BUILDKITE_AGENT_TOKEN is not set"
              fi
              
              # Set BuildKite meta-data for architecture
              export BUILDKITE_AGENT_META_DATA="architecture=x64,${BUILDKITE_AGENT_META_DATA:-}"
            '';
          };

          ci-arm64 = pkgs.mkShell {
            buildInputs = with pkgs; [
              buildkite-agent
              # Include the arm64 build environment tools
              buildEnvArm64
            ];

            shellHook = ''
              echo "BuildKite CI environment initialized (arm64)"
              
              # Set up BuildKite agent configuration if needed
              if [ -z "$BUILDKITE_AGENT_TOKEN" ]; then
                echo "Warning: BUILDKITE_AGENT_TOKEN is not set"
              fi
              
              # Set BuildKite meta-data for architecture
              export BUILDKITE_AGENT_META_DATA="architecture=arm64,${BUILDKITE_AGENT_META_DATA:-}"
            '';
          };

          # Generic CI shell that defaults to x64
          ci = pkgs.mkShell {
            buildInputs = with pkgs; [
              buildkite-agent
              # Include the x64 build environment tools by default
              buildEnvX64
            ];

            shellHook = ''
              echo "BuildKite CI environment initialized (default: x64)"
              
              # Set up BuildKite agent configuration if needed
              if [ -z "$BUILDKITE_AGENT_TOKEN" ]; then
                echo "Warning: BUILDKITE_AGENT_TOKEN is not set"
              fi
            '';
          };
        };
      });
}