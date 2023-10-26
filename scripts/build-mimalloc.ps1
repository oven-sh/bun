$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

Set-Location (Join-Path $BUN_DEPS_DIR 'mimalloc')
cmake $CMAKE_FLAGS `
    -DMI_SKIP_COLLECT_ON_EXIT=1 `
    -DMI_BUILD_SHARED=OFF `
    -DMI_BUILD_STATIC=ON `
    -DMI_BUILD_TESTS=OFF `
    -DMI_OSX_ZONE=OFF `
    -DMI_OSX_INTERPOSE=OFF `
    -DMI_BUILD_OBJECT=ON `
    -DMI_USE_CXX=ON `
    -DMI_OVERRIDE=OFF `
    -DMI_OSX_ZONE=OFF `

cmake --build . --clean-first --config Release

Copy-Item **/*.lib $BUN_DEPS_OUT_DIR

Set-Location $CWD
