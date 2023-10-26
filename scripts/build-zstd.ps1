$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

Set-Location (Join-Path $BUN_DEPS_DIR 'zstd\build\cmake')
cmake $CMAKE_FLAGS -DZSTD_BUILD_STATIC=ON -DCMAKE_BUILD_TYPE=Release
cmake --build . --clean-first --config Release
Copy-Item lib\*\**.lib $BUN_DEPS_OUT_DIR

Set-Location $CWD
