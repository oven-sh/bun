$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'zlib')
try {
  Run git reset --hard
  Run git apply -v (Join-Path $PSScriptRoot "../src/deps/zlib-clangcl.patch") --whitespace=fix

  Set-Location (mkdir -Force build)
  
  Run cmake .. @CMAKE_FLAGS
  Run cmake --build . --clean-first --config Release

  Copy-Item zlib.lib $BUN_DEPS_OUT_DIR

  Write-Host "-> zlib.lib"
}
finally { Pop-Location }
