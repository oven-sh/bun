$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'libarchive')
try {
  Set-Location (mkdir -Force build)

  Run cmake @CMAKE_FLAGS -DBUILD_SHARED_LIBS=OFF -DENABLE_TEST=OFF -DENABLE_INSTALL=OFF -DENABLE_WERROR=0 -DENABLE_ICONV=0 -DENABLE_LibGCC=0 -DENABLE_LZMA=0 -DENABLE_LZ4=0 -DENABLE_LIBXML2=0 -DENABLE_LIBB2=0 -DENABLE_OPENSSL=0 -DENABLE_CAT=0 ..
  Run cmake  --build . --clean-first --config Release

  Copy-Item libarchive\archive_static.lib $BUN_DEPS_OUT_DIR\archive.lib
  Write-Host "-> archive.lib"
}
finally {
  Pop-Location
}
