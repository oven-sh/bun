param (
  [switch] $Baseline = $False,
  [switch] $Fast = $False
)

$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash

$Tag = If ($Baseline) { "bun-windows-x64-baseline" } Else { "bun-windows-x64" }
$TagSuffix = If ($Baseline) { "-Baseline" } Else { "" }
$UseBaselineBuild = If ($Baseline) { "ON" } Else { "OFF" }
$UseLto = If ($Fast) { "OFF" } Else { "ON" }

.\scripts\env.ps1 $TagSuffix

mkdir -Force build
buildkite-agent artifact download "**" . --step "${Tag}-build-zig"
buildkite-agent artifact download "**" . --step "${Tag}-build-cpp"
buildkite-agent artifact download "**" . --step "${Tag}-build-deps"

Set-Location build
$CANARY_REVISION = 0
cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release `
  -DNO_CODEGEN=1 `
  -DNO_CONFIGURE_DEPENDS=1 `
  "-DCPU_TARGET=${CPU_TARGET}" `
  "-DCANARY=${CANARY_REVISION}" `
  -DBUN_LINK_ONLY=1 `
  "-DUSE_BASELINE_BUILD=${UseBaselineBuild}" `
  "-DUSE_LTO=${UseLto}" `
  "-DBUN_DEPS_OUT_DIR=$(Resolve-Path bun-deps)" `
  "-DBUN_CPP_ARCHIVE=$(Resolve-Path bun-cpp-objects.a)" `
  "-DBUN_ZIG_OBJ_DIR=$(Resolve-Path .)" `
  "$Flags"
if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }

ninja -v
if ($LASTEXITCODE -ne 0) { throw "Link failed!" }

Set-Location ..
$Dist = mkdir -Force "${Tag}"
cp -r release\bun.exe "$Dist\bun.exe"
Compress-Archive -Force "$Dist" "${Dist}.zip"
$Dist = "$Dist-profile"
MkDir -Force "$Dist"
cp -r release\bun.exe "$Dist\bun.exe"
cp -r release\bun.pdb "$Dist\bun.pdb"
Compress-Archive -Force "$Dist" "$Dist.zip"

$env:BUN_GARBAGE_COLLECTOR_LEVEL = "1"
$env:BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING = "1"
.\release\bun.exe --print "JSON.stringify(require('bun:internal-for-testing').crash_handler.getFeatureData())" > .\features.json
