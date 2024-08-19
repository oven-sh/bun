$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'zstd')
try {
  Remove-Item CMakeCache.txt, CMakeFiles -Recurse -ErrorAction SilentlyContinue
  
  # CL_SHOWINCLUDES_PREFIX is workaround for cmake bug in 3.28. .ninja_deps still needs to be deleted. Bug is fixed in 3.30
  Run cmake -S "build/cmake" @CMAKE_FLAGS -DZSTD_BUILD_STATIC=ON -DCMAKE_CL_SHOWINCLUDES_PREFIX="Note: including file:"
  Run cmake --build . --clean-first --config Release

  Copy-Item lib/zstd_static.lib $BUN_DEPS_OUT_DIR/zstd.lib
  Write-Host "-> zstd.lib"
} finally { Pop-Location }