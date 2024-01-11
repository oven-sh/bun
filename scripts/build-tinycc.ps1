$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'tinycc\win32')
try {
  Run .\build-tcc.bat -clean
  Run .\build-tcc.bat -c 'cl'

  Copy-Item libtcc.lib $BUN_DEPS_OUT_DIR/tcc.lib

  Write-Host "-> tcc.lib"
} finally { Pop-Location }
