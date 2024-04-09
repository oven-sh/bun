$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'c-ares')
try {
  Remove-Item -Force -Recurse -ErrorAction SilentlyContinue build
  Set-Location (mkdir -Force build)

  Run cmake @CMAKE_FLAGS -DCARES_STATIC=ON -DCARES_SHARED=OFF .. 
  Run cmake --build . --clean-first
  
  Copy-Item lib\cares.lib $BUN_DEPS_OUT_DIR
  Write-Host "-> cares.lib"
}
finally {
  Pop-Location
}
