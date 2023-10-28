$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'base64')
try {
  Set-Location (mkdir -Force build)

  Run cmake @CMAKE_FLAGS -DBASE64_WERROR=0 ..
  Run cmake --build . --clean-first --config Release
  
  Copy-Item base64.lib $BUN_DEPS_OUT_DIR
  Write-Host "-> base64.lib"
}
finally {
  Pop-Location
}
