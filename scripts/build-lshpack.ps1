$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'ls-hpack')
try {
  Set-Location (mkdir -Force build)
  
  Run cmake .. @CMAKE_FLAGS `
    -DCMAKE_BUILD_TYPE=Release `
    -DLSHPACK_XXH=ON `
    -DSHARED=0

  Run cmake --build . --clean-first --config Release

  Copy-Item ls-hpack.lib $BUN_DEPS_OUT_DIR/lshpack.lib

  Write-Host "-> lshpack.lib"
} finally { Pop-Location }
