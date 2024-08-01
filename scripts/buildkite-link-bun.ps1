param(
  [switch]$Baseline = $false
)

$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash

$Target = If ($Baseline) { "windows-x64-baseline" } Else { "windows-x64" }
$Tag = "bun-$Target"

. (Join-Path $PSScriptRoot "env.ps1")

mkdir -Force build
buildkite-agent artifact download "**" build --step "${Target}-build-zig"
buildkite-agent artifact download "**" build --step "${Target}-build-cpp"
buildkite-agent artifact download "**" build --step "${Target}-build-deps"
mv -Force -ErrorAction SilentlyContinue build\build\bun-deps\* build\bun-deps
mv -Force -ErrorAction SilentlyContinue build\build\* build

Set-Location build

# HACK: See scripts/build-bun-cpp.ps1
Join-File -Path "$(Resolve-Path .)\bun-cpp-objects.a" -Verbose -DeletePartFiles

cmake .. @CMAKE_FLAGS `
  -G Ninja `
  -DCMAKE_BUILD_TYPE=Release `
  -DNO_CODEGEN=1 `
  -DNO_CONFIGURE_DEPENDS=1 `
  -DBUN_LINK_ONLY=1 `
  "-DBUN_DEPS_OUT_DIR=$(Resolve-Path bun-deps)" `
  "-DBUN_CPP_ARCHIVE=$(Resolve-Path bun-cpp-objects.a)" `
  "-DBUN_ZIG_OBJ_DIR=$(Resolve-Path .)"
if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }

ninja -v -j $env:CPUS
if ($LASTEXITCODE -ne 0) { throw "Link failed!" }

Set-Location ..
$Dist = mkdir -Force "${Tag}"
cp -r build\bun.exe "$Dist\bun.exe"
Compress-Archive -Force "$Dist" "${Dist}.zip"
$Dist = "$Dist-profile"
MkDir -Force "$Dist"
cp -r build\bun.exe "$Dist\bun.exe"
cp -r build\bun.pdb "$Dist\bun.pdb"
Compress-Archive -Force "$Dist" "$Dist.zip"

$env:BUN_GARBAGE_COLLECTOR_LEVEL = "1"
$env:BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING = "1"
.\build\bun.exe --print "JSON.stringify(require('bun:internal-for-testing').crash_handler.getFeatureData())" > .\features.json
