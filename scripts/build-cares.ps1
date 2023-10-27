$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

Set-Location (Join-Path $BUN_DEPS_DIR 'c-ares')
Remove-Item -r build -ErrorAction SilentlyContinue
$null = mkdir build -ErrorAction SilentlyContinue
Set-Location build
cmake $CMAKE_FLAGS -DCARES_STATIC=ON -DCARES_SHARED=OFF .. 
cmake --build . --clean-first --config Release
Copy-Item ./lib/Release/*.lib $BUN_DEPS_OUT_DIR

Set-Location $CWD