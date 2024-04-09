$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'boringssl')
try {
  Set-Location (mkdir -Force build)
  
  # still use -DCMAKE_BUILD_TYPE=Release unconditionally here because it fails otherwise
  # lld-link: error: /failifmismatch: mismatch detected for '_ITERATOR_DEBUG_LEVEL':
  # >>> CMakeFiles\bun-debug.dir\codegen\WebCoreJSBuiltins.cpp.obj has value 0
  # >>> ssl.lib(bio_ssl.cc.obj) has value 2
  Run cmake @CMAKE_FLAGS .. -DCMAKE_BUILD_TYPE=Release
  Run cmake --build . --target crypto --target ssl --target decrepit --clean-first

  Copy-Item crypto/crypto.lib $BUN_DEPS_OUT_DIR
  Copy-Item ssl/ssl.lib $BUN_DEPS_OUT_DIR
  Copy-Item decrepit/decrepit.lib $BUN_DEPS_OUT_DIR
  Write-Host "-> crypto.lib, ssl.lib, decrepit.lib"
} finally { Pop-Location }
