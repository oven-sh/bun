. (Join-Path $PSScriptRoot "env.ps1")
$ErrorActionPreference = 'SilentlyContinue'  # Setting strict mode, similar to 'set -euo pipefail' in bash

function Reset-Submodule {
  param (
    $Repository
  )
  Push-Location $Repository
  try {
    Run git reset --hard
    Run git clean -fdx
  }
  finally {
    Pop-Location
  }
}

$Deps = Join-Path $PSScriptRoot "../src/deps"
$DepsOut = Join-Path $PSScriptRoot "../src/deps"

Reset-Submodule $Deps\base64
Reset-Submodule $Deps\boringssl
Reset-Submodule $Deps\c-ares
Reset-Submodule $Deps\libarchive
Reset-Submodule $Deps\lol-html
Reset-Submodule $Deps\mimalloc
Reset-Submodule $Deps\picohttpparser
Reset-Submodule $Deps\tinycc
Reset-Submodule $Deps\zlib
Reset-Submodule $Deps\zstd
Reset-Submodule $Deps\ls-hpack

Remove-Item -Force $DepsOut\base64.lib
Remove-Item -Force $DepsOut\crypto.lib
Remove-Item -Force $DepsOut\ssl.lib
Remove-Item -Force $DepsOut\decrepit.lib
Remove-Item -Force $DepsOut\cares.lib
Remove-Item -Force $DepsOut\archive.lib
Remove-Item -Force $DepsOut\lolhtml.lib
Remove-Item -Force $DepsOut\mimalloc.lib
Remove-Item -Force $DepsOut\tcc.lib
Remove-Item -Force $DepsOut\zlib.lib
Remove-Item -Force $DepsOut\zstd.lib
Remove-Item -Force $DepsOut\libuv.lib
Remove-Item -Force $DepsOut\lshpack.lib

$ErrorActionPreference = 'Stop'
