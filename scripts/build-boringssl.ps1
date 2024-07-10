$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'boringssl')
try {
  Set-Location (mkdir -Force build)
  
  Run cmake @CMAKE_FLAGS ..
  Run cmake --build . --target crypto --target ssl --target decrepit --clean-first --config Release

  Copy-Item crypto/crypto.lib $BUN_DEPS_OUT_DIR
  Copy-Item ssl/ssl.lib $BUN_DEPS_OUT_DIR
  Copy-Item decrepit/decrepit.lib $BUN_DEPS_OUT_DIR
  Write-Host "-> crypto.lib, ssl.lib, decrepit.lib"
} finally { Pop-Location }
