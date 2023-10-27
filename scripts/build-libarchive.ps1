$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

Set-Location $BUN_DEPS_DIR/libarchive
cmake -DBUILD_SHARED_LIBS=OFF -DENABLE_TEST=OFF -DENABLE_INSTALL=OFF -DENABLE_WERROR=0 $CMAKE_FLAGS .
cmake  --build . --target ALL_BUILD --clean-first --config Release
Copy-Item libarchive/Release/archive.lib $BUN_DEPS_OUT_DIR

Set-Location $CWD
