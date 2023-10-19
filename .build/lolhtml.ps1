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

Set-Location $BUN_DEPS_DIR/lol-html/c-api
cargo build --release --target x86_64-pc-windows-msvc
Copy-Item target/x86_64-pc-windows-msvc/release/lolhtml.lib $BUN_DEPS_OUT_DIR
Copy-Item target/x86_64-pc-windows-msvc/release/lolhtml.pdb $BUN_DEPS_OUT_DIR