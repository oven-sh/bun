$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

$null = mkdir -p $BUN_DEPS_OUT_DIR -Force
Set-Location $BUN_DEPS_DIR/boringssl
cmake $CMAKE_FLAGS .
cmake --build . --target crypto --target ssl --target decrepit --clean-first --config Release
Copy-Item crypto/Release/crypto.lib $BUN_DEPS_OUT_DIR
Copy-Item ssl/Release/ssl.lib $BUN_DEPS_OUT_DIR
Copy-Item decrepit/Release/decrepit.lib $BUN_DEPS_OUT_DIR

Set-Location $CWD
