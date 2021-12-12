{ stdenv
, autoPatchelfHook
, fetchurl
, openssl
, unzip
, pkgs
, ... }:
let
  version = "0.0.52";
  checksum = "88k0RW6/X/CudqExRwnbfzpKcxHJ3BvtvX2dIudqU+A=";
  bun_install = "/home/<whatever>/.bun"; # Set this to where you want bun's cache
in stdenv.mkDerivation {
    pname = "bun";
    version = version;
    src =  fetchurl {
      url = "https://github.com/Jarred-Sumner/bun-releases-for-updater/releases/download/bun-v${version}/bun-linux-x64.zip";
      sha256 = checksum;
    };
    sourceRoot = ".";
    unpackCmd = "unzip bun-linux-x64.zip";
    dontConfigure = true;
    dontBuild = true;
    nativeBuildInputs = [ pkgs.makeWrapper autoPatchelfHook ];
    buildInputs = [ unzip openssl stdenv.cc.cc.lib ];
      
    installPhase = "install -D ./bun-linux-x64/bun $out/bin/bun";
    postInstall = ''
      wrapProgram "$out/bin/bun" \
        --prefix BUN_INSTALL : ${bun_install}
    '';
}