$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'highway')
try {
  Run git reset --hard
  
  Set-Location (mkdir -Force build)
  
  Run cmake -DHWY_ENABLE_TESTS=OFF -DHWY_ENABLE_CONTRIB=OFF -DHWY_ENABLE_EXAMPLES=OFF -DHWY_ENABLE_INSTALL=ON .. @CMAKE_FLAGS
  Run cmake --build . --clean-first --config Release

  Copy-Item hwy.lib $BUN_DEPS_OUT_DIR

  Write-Host "-> hwy.lib"
}
finally { Pop-Location }