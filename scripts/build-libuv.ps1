param(
  [bool] $CloneOnly = $false
)

$ErrorActionPreference = 'Stop' # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

$Source = (Join-Path $PSScriptRoot "../src/deps/libuv")
$Commit = "da527d8d2a908b824def74382761566371439003"

if (!(Test-Path -PathType Container $Source)) {
  Write-Host "Cloning libuv: $Commit"
  New-Item -ItemType Directory -Force -Path $Source
  Push-Location $Source
  try {
    Run git init
    Run git remote add origin "https://github.com/libuv/libuv"
    Run git fetch --depth 1 origin $Commit
    Run git checkout FETCH_HEAD
  } finally { Pop-Location }
} else {
  Push-Location $Source
  try {
    $CurrentCommit = git rev-parse HEAD
    if ($CurrentCommit -ne $Commit) {
      Write-Host "Updating libuv: $Commit"
      Run git fetch --depth 1 origin $Commit
      Run git checkout FETCH_HEAD
    }
  } finally { Pop-Location }
}

if(!($CloneOnly)) { 
  Push-Location $Source
  try {
    $null = mkdir build -ErrorAction SilentlyContinue
    Set-Location build
    
    Run cmake .. @CMAKE_FLAGS "-DCMAKE_C_FLAGS=/DWIN32 /D_WINDOWS -Wno-int-conversion"
    Run cmake --build . --clean-first --config Release

    Copy-Item libuv.lib $BUN_DEPS_OUT_DIR
    Write-Host "-> libuv.lib"
  } finally { Pop-Location }
}
