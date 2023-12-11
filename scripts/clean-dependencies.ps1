$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

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

Reset-Submodule $Deps/base64
Reset-Submodule $Deps/boringssl
Reset-Submodule $Deps/c-ares
Reset-Submodule $Deps/libarchive
Reset-Submodule $Deps/lol-html
Reset-Submodule $Deps/mimalloc
Reset-Submodule $Deps/picohttpparser
Reset-Submodule $Deps/tinycc
Reset-Submodule $Deps/zlib
Reset-Submodule $Deps/zstd
Reset-Submodule $Deps/ls-hpack