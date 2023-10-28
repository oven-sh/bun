$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

$CWD = Get-Location

Set-Location (Join-Path $BUN_DEPS_DIR 'base64')
cmake $CMAKE_FLAGS .
cmake --build . --clean-first --config Release
Copy-Item **/*.lib $BUN_DEPS_OUT_DIR

Set-Location $CWD