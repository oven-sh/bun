$ErrorActionPreference = 'Stop' # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

$UVSource = (Join-Path $PSScriptRoot "../build/libuv")
if (!(test-path -PathType container $UVSource)) {
  Set-Location (Join-Path $PSScriptRoot "../build")
  git clone "https://github.com/libuv/libuv" libuv --depth=1
}

Set-Location $UVSource
New-Item -ItemType Directory -Force -Path build
Set-Location build
cmake .. $CMAKE_FLAGS "-DCMAKE_C_FLAGS=`"/DWIN32 /D_WINDOWS -Wno-int-conversion`""
cmake --build . --clean-first --config Release

Copy-Item .\libuv.lib $BUN_DEPS_OUT_DIR

Set-Location $CWD
