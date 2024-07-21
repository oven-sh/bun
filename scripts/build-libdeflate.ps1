$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'libdeflate')
try {
  Remove-Item CMakeCache.txt, CMakeFiles, build -Recurse -ErrorAction SilentlyContinue
  mkdir -Force build

  Run cmake -S "." -B build @CMAKE_FLAGS -DLIBDEFLATE_BUILD_STATIC_LIB=ON -DLIBDEFLATE_BUILD_SHARED_LIB=OFF -DLIBDEFLATE_BUILD_GZIP=OFF
  Run cmake --build build --clean-first --config Release

  Copy-Item build/libdeflate_static.lib $BUN_DEPS_OUT_DIR/deflate.lib
  Write-Host "-> deflate.lib"
} finally { Pop-Location }

