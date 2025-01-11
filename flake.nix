{
	description = "Incredibly fast JavaScript runtime, bundler, test runner, and package manager – all in one";

	inputs = {
		nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
		flake-utils.url = "github:numtide/flake-utils";
		zig.url = "github:mitchellh/zig-overlay";

# Used for shell.nix
		flake-compat = {
			url = github:edolstra/flake-compat;
			flake = false;
		};
	};

	outputs = {
		self,
		nixpkgs,
		flake-utils,
		...
	} @ inputs: let
	overlays = [
		(final: prev: {
# Any other packages
		 zig = inputs.zig.packages.${prev.system};
		 })
	];

# Our supported systems
	systems = ["aarch64-linux" "aarch64-darwin" "x86_64-darwin" "x86_64-linux"];
	in
		flake-utils.lib.eachSystem systems (
			system: let
			pkgs = import nixpkgs {inherit overlays system;};
			in {
				devShells.default = pkgs.mkShell {
					 nativeBuildInputs = with pkgs; [
						automake
						zig.master
						ccache
						cmake
						coreutils-full
						gnused
						go
						libiconv
						libtool
						ninja
						pkg-config
						ruby
						rustc
						cargo
						bun
						llvmPackages_18.lldb
						llvmPackages_18.libstdcxxClang
						llvmPackages_18.libllvm
						llvmPackages_18.libcxx
						lld
						clang-tools
						clang
						autoconf
						icu
					] ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
						apple-sdk_15
					];

					hardeningDisable = [ "all" ];

					shellHook = ''
            export CC="${pkgs.llvmPackages_18.libstdcxxClang}/bin/clang"
            export CXX="${pkgs.llvmPackages_18.libstdcxxClang}/bin/clang++"
        	'';
				};

# For compatibility with older versions of the `nix` binary
				devShell = self.devShells.${system}.default;
			}
		);
}
