$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash

$SCRIPT_DIR = Split-Path $PSScriptRoot -Parent
$CMAKE_FLAGS = $env:CMAKE_FLAGS
$BUN_BASE_DIR = if ($env:BUN_BASE_DIR) { $env:BUN_BASE_DIR } else { $SCRIPT_DIR }
$BUN_DEPS_OUT_DIR = if ($env:BUN_DEPS_OUT_DIR) { $env:BUN_DEPS_OUT_DIR } else { Join-Path $BUN_BASE_DIR 'src\deps' }
$BUN_DEPS_DIR = if ($env:BUN_DEPS_DIR) { $env:BUN_DEPS_DIR } else { Join-Path $BUN_BASE_DIR 'src\deps' }
$CCACHE_CC_FLAG = $env:CCACHE_CC_FLAG
$CPUS = if ($env:CPUS) { $env:CPUS } else { (Get-WmiObject -Class Win32_ComputerSystem).NumberOfLogicalProcessors }
$CFLAGS = $env:CFLAGS
$CXXFLAGS = $env:CXXFLAGS

# Create the output directory if it doesn't exist
if (-not (Test-Path $BUN_DEPS_OUT_DIR)) {
    New-Item -ItemType Directory -Path $BUN_DEPS_OUT_DIR
}

Set-Location (Join-Path $BUN_DEPS_DIR 'c-ares')
rm -r build -ErrorAction SilentlyContinue
mkdir build -ErrorAction SilentlyContinue
cd build
cmake $CMAKE_FLAGS -DCMAKE_BUILD_TYPE=Release -G "Visual Studio 17 2022" -DCARES_STATIC=ON -DCARES_SHARED=OFF .. 
cmake --build . --clean-first --config Release
cp ./lib/Release/*.lib $BUN_DEPS_OUT_DIR
