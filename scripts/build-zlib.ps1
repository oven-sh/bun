$ErrorActionPreference = 'Stop' # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

# The current pinned commit of zlib in bun is on a fork that doesnt work on Windows,
# so here we use a different repo. There's a possibility this other fork (zlib-ng) has similar
# performance to what we have now (cloudflare/zlib), but need to benchmark first.
$ZlibSource = (Join-Path $PSScriptRoot "../build/zlib-ng")
if (!(test-path -PathType container $ZlibSource)) {
  Set-Location (Join-Path $PSScriptRoot "../build")
  git clone "https://github.com/zlib-ng/zlib-ng" zlib-ng
}

Set-Location $ZlibSource
New-Item -ItemType Directory -Force -Path build
Set-Location build
cmake .. -DCMAKE_BUILD_TYPE=Release -DZLIB_COMPAT=1 -DWITH_NATIVE_INSTRUCTIONS=1 -DWITH_GTEST=0
cmake --build . --clean-first --config Release
Copy-Item .\Release\zlibstatic.lib $BUN_DEPS_OUT_DIR

Set-Location $CWD
