# Bun from the official release binaries. To move to a new release, run
# `bun scripts/update-nix-sources.ts`, which rewrites ./sources.json.
{
  lib,
  stdenvNoCC,
  fetchurl,
  autoPatchelfHook,
  unzip,
  installShellFiles,
  cctools,
  darwin,
  rcodesign,
}:

let
  sources = lib.importJSON ./sources.json;
  system = stdenvNoCC.hostPlatform.system;
  source = sources.sources.${system} or (throw "bun: unsupported system ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "bun";
  inherit (sources) version;

  src = fetchurl {
    url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/${source.asset}.zip";
    inherit (source) sha256;
  };
  sourceRoot = source.asset;

  strictDeps = true;
  nativeBuildInputs = [
    unzip
    installShellFiles
  ]
  ++ lib.optionals stdenvNoCC.hostPlatform.isLinux [ autoPatchelfHook ];

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    install -Dm 755 ./bun $out/bin/bun
    ln -s $out/bin/bun $out/bin/bunx

    runHook postInstall
  '';

  # Runs after autoPatchelfHook so the completions come from the patched binary.
  postPhases = [ "postPatchelf" ];
  postPatchelf =
    lib.optionalString stdenvNoCC.hostPlatform.isDarwin ''
      '${lib.getExe' cctools "${cctools.targetPrefix}install_name_tool"}' $out/bin/bun \
        -change /usr/lib/libicucore.A.dylib '${lib.getLib darwin.ICU}/lib/libicucore.A.dylib'
      '${lib.getExe rcodesign}' sign --code-signature-flags linker-signed $out/bin/bun
    ''
    + lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
      installShellCompletion --cmd bun \
        --bash <(SHELL="bash" $out/bin/bun completions) \
        --zsh <(SHELL="zsh" $out/bin/bun completions) \
        --fish <(SHELL="fish" $out/bin/bun completions)
    '';

  meta = {
    description = "Fast all-in-one JavaScript runtime, bundler, test runner, and package manager";
    homepage = "https://bun.com";
    changelog = "https://bun.com/blog/bun-v${finalAttrs.version}";
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    license = with lib.licenses; [
      mit # bun
      lgpl21Only # JavaScriptCore and WebKit
    ];
    mainProgram = "bun";
    platforms = builtins.attrNames sources.sources;
  };
})
