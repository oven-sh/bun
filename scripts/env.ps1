param(
  [switch]$Baseline = $False
)
$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash

# this is the environment script for building bun's dependencies
# it sets c compiler and flags
$ScriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent

if ($env:VSINSTALLDIR -eq $null) {
  Write-Host "Loading Visual Studio environment, this may take a second..."
  $vsDir = Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022" -Directory
  if ($vsDir -eq $null) {
      throw "Visual Studio directory not found."
  } 
  Push-Location $vsDir.FullName
  try {
    . (Join-Path -Path $vsDir.FullName -ChildPath "Common7\Tools\Launch-VsDevShell.ps1") -Arch amd64 -HostArch amd64
  } finally { Pop-Location }
}

if($Env:VSCMD_ARG_TGT_ARCH -eq "x86") {
  # Please do not try to compile Bun for 32 bit. It will not work. I promise.
  throw "Visual Studio environment is targetting 32 bit. This configuration is definetly a mistake."
}

$BUN_BASE_DIR = if ($env:BUN_BASE_DIR) { $env:BUN_BASE_DIR } else { Join-Path $ScriptDir '..' }
$BUN_DEPS_DIR = if ($env:BUN_DEPS_DIR) { $env:BUN_DEPS_DIR } else { Join-Path $BUN_BASE_DIR 'src\deps' }
$BUN_DEPS_OUT_DIR = if ($env:BUN_DEPS_OUT_DIR) { $env:BUN_DEPS_OUT_DIR } else { $BUN_DEPS_DIR }

$CPUS = if ($env:CPUS) { $env:CPUS } else { (Get-WmiObject -Class Win32_Processor).NumberOfCores }

$CC = "clang-cl"
$CXX = "clang-cl"

$CFLAGS = '/O2'
# $CFLAGS = '/O2 /MT'
$CXXFLAGS = '/O2'
# $CXXFLAGS = '/O2 /MT'

if ($Baseline) {
  $CFLAGS += ' -march=nehalem'
  $CXXFLAGS += ' -march=nehalem'
}

$CMAKE_FLAGS = @(
  "-GNinja",
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_C_COMPILER=$CC",
  "-DCMAKE_CXX_COMPILER=$CXX",
  "-DCMAKE_C_FLAGS=`"$CFLAGS`"",
  "-DCMAKE_CXX_FLAGS=`"$CXXFLAGS`""
)
$env:CC = "clang-cl"
$env:CXX = "clang-cl"
$env:CFLAGS = $CFLAGS
$env:CXXFLAGS = $CXXFLAGS
$env:CPUS = $CPUS

if ($Baseline) {
  $CMAKE_FLAGS += "-DUSE_BASELINE_BUILD=ON"
}

$null = New-Item -ItemType Directory -Force -Path $BUN_DEPS_OUT_DIR

function Run() {
  # A handy way to run a command, and automatically throw an error if the
  # exit code is non-zero.

  if ($args.Count -eq 0) {
    throw "Must supply some arguments."
  }

  $command = $args[0]
  $commandArgs = @()
  if ($args.Count -gt 1) {
    $commandArgs = $args[1..($args.Count - 1)]
  }

  & $command $commandArgs
  $result = $LASTEXITCODE

  if ($result -ne 0) {
    throw "$command $commandArgs exited with code $result."
  }
}
