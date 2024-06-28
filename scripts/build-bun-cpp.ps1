param (
  [switch] $Baseline = $False,
  [switch] $Fast = $False
)

$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash

$Tag = If ($Baseline) { "-Baseline" } Else { "" }
$UseBaselineBuild = If ($Baseline) { "ON" } Else { "OFF" }
$UseLto = If ($Fast) { "OFF" } Else { "ON" }

# $CANARY_REVISION = if (Test-Path build/.canary_revision) { Get-Content build/.canary_revision } else { "0" }
$CANARY_REVISION = 0
.\scripts\env.ps1 $Tag
.\scripts\update-submodules.ps1
.\scripts\build-libuv.ps1 -CloneOnly $True
cd build

cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release `
  -DNO_CODEGEN=0 `
  -DNO_CONFIGURE_DEPENDS=1 `
  "-DUSE_BASELINE_BUILD=${UseBaselineBuild}" `
  "-DUSE_LTO=${UseLto}" `
  "-DCANARY=${CANARY_REVISION}" `
  -DBUN_CPP_ONLY=1 $Flags
if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }

.\compile-cpp-only.ps1 -v
if ($LASTEXITCODE -ne 0) { throw "C++ compilation failed" }