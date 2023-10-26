$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash

# this is the environment script for building bun's dependencies
# it sets c compiler and flags
$ScriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent

$BUN_BASE_DIR = if ($env:BUN_BASE_DIR) { $env:BUN_BASE_DIR } else { Join-Path $ScriptDir '..' }
$BUN_DEPS_DIR = if ($env:BUN_DEPS_DIR) { $env:BUN_DEPS_DIR } else { Join-Path $BUN_BASE_DIR 'src\deps' }
$BUN_DEPS_OUT_DIR = if ($env:BUN_DEPS_OUT_DIR) { $env:BUN_DEPS_OUT_DIR } else { $BUN_DEPS_DIR }

# this compiler detection could be better
$CPUS = if ($env:CPUS) { $env:CPUS } else { (Get-WmiObject -Class Win32_Processor).NumberOfCores }

$CFLAGS = '/O2'
$CXXFLAGS = '/O2'

$Env:CFLAGS = $CFLAGS
$Env:CXXFLAGS = $CXXFLAGS

$CMAKE_FLAGS = @(
  "-DCMAKE_C_FLAGS=`"$CFLAGS`"",
  "-DCMAKE_CXX_FLAGS=`"$CXXFLAGS`"",
  "-DCMAKE_BUILD_TYPE=Release"
)

$null = New-Item -ItemType Directory -Force -Path $BUN_DEPS_OUT_DIR
