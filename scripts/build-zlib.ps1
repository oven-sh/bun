$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'zlib')
try {
  Run git reset --hard
  
  # TODO: make a patch upstream to change the line
  # `#ifdef _MSC_VER`
  # to account for clang-cl, which implements `__builtin_ctzl` and `__builtin_expect`
  $textToReplace = [regex]::Escape("int __inline __builtin_ctzl(unsigned long mask)") + "[^}]*}"
  $fileContent = Get-Content "deflate.h" -Raw
  if ($fileContent -match $textToReplace) {
    Set-Content -Path "deflate.h" -Value ($fileContent -replace $textToReplace, "")
  }
  else {
    throw "Failed to patch deflate.h"
  }

  Set-Location (mkdir -Force build)
  
  Run cmake .. @CMAKE_FLAGS
  Run cmake --build . --clean-first --config Release

  Copy-Item zlib.lib $BUN_DEPS_OUT_DIR

  Write-Host "-> zlib.lib"
}
finally { Pop-Location }
