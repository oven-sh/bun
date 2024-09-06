$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'libarchive')
try {
  Remove-Item -Recurse -Force libarchive-build -ErrorAction SilentlyContinue
  Set-Location (mkdir -Force libarchive-build)

  Run cmake @CMAKE_FLAGS -DBUILD_SHARED_LIBS=0 -DENABLE_BZIP2=0 -DENABLE_CAT=0 -DENABLE_EXPAT=0 -DENABLE_ICONV=0 -DENABLE_INSTALL=0 -DENABLE_LIBB2=0 -DENABLE_LibGCC=0 -DENABLE_LIBXML2=0 -DENABLE_LZ4=0 -DENABLE_LZMA=0 -DENABLE_LZO=0 -DENABLE_MBEDTLS=0 -DENABLE_NETTLE=0 -DENABLE_OPENSSL=0 -DENABLE_PCRE2POSIX=0 -DENABLE_PCREPOSIX=0 -DENABLE_TEST=0 -DENABLE_WERROR=0 -DENABLE_ZLIB=0 -DENABLE_ZSTD=0 -DHAVE_ZLIB_H=1 ..
  Run cmake  --build . --clean-first --config Release --verbose --target archive_static

  Copy-Item libarchive\archive.lib $BUN_DEPS_OUT_DIR\archive.lib
  Write-Host "-> archive.lib"
}
finally {
  Pop-Location
}
