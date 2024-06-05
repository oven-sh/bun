param(
  [switch]$Baseline = $false
)

if ($ENV:BUN_DEV_ENV_SET -eq "Baseline=True") {
  $Baseline = $true
}

$ErrorActionPreference = 'Stop' # Setting strict mode, similar to 'set -euo pipefail' in bash

# this is the environment script for building bun's dependencies
# it sets c compiler and flags
$ScriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent

if ($env:VSINSTALLDIR -eq $null) {
  Write-Host "Loading Visual Studio environment, this may take a second..."
  $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  if (!(Test-Path $vswhere)) {
      throw "Visual Studio installer directory not found."
  }
  $vsDir = (& $vswhere -prerelease -latest -property installationPath)
  if ($vsDir -eq $null) {
      $vsDir = Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022" -Directory
      if ($vsDir -eq $null) {
          throw "Visual Studio directory not found."
      }
      $vsDir = $vsDir.FullName;
  }
  Push-Location $vsDir
  try {
    Import-Module 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
    Enter-VsDevShell -VsInstallPath 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools' -DevCmdArguments '-arch=x64 -host_arch=x64'
  } catch {
    $launchps = (Join-Path -Path $vsDir -ChildPath "Common7\Tools\Launch-VsDevShell.ps1")
    . $launchps -Arch amd64 -HostArch amd64
  } finally { Pop-Location }
}

if($Env:VSCMD_ARG_TGT_ARCH -eq "x86") {
  # Please do not try to compile Bun for 32 bit. It will not work. I promise.
  throw "Visual Studio environment is targetting 32 bit. This configuration is definetly a mistake."
}

$ENV:BUN_DEV_ENV_SET = "Baseline=$Baseline";

$BUN_BASE_DIR = if ($env:BUN_BASE_DIR) { $env:BUN_BASE_DIR } else { Join-Path $ScriptDir '..' }
$BUN_DEPS_DIR = if ($env:BUN_DEPS_DIR) { $env:BUN_DEPS_DIR } else { Join-Path $BUN_BASE_DIR 'src\deps' }
$BUN_DEPS_OUT_DIR = if ($env:BUN_DEPS_OUT_DIR) { $env:BUN_DEPS_OUT_DIR } else { $BUN_DEPS_DIR }

$CPUS = if ($env:CPUS) { $env:CPUS } else { (Get-CimInstance -Class Win32_Processor).NumberOfCores }

$CC = "clang-cl"
$CXX = "clang-cl"

$CFLAGS = '/O2 /Zi'
# $CFLAGS = '/O2 /Z7 /MT'
$CXXFLAGS = '/O2 /Zi'
# $CXXFLAGS = '/O2 /Z7 /MT'

$CPU_NAME = if ($Baseline) { "nehalem" } else { "haswell" };

$CFLAGS += " -march=${CPU_NAME}"
$CXXFLAGS += " -march=${CPU_NAME}"

$CMAKE_FLAGS = @(
  "-GNinja",
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_C_COMPILER=$CC",
  "-DCMAKE_CXX_COMPILER=$CXX",
  "-DCMAKE_C_FLAGS=$CFLAGS",
  "-DCMAKE_CXX_FLAGS=$CXXFLAGS"
)
$env:CC = "clang-cl"
$env:CXX = "clang-cl"
$env:CFLAGS = $CFLAGS
$env:CXXFLAGS = $CXXFLAGS
$env:CPUS = $CPUS

if ($Baseline) {
  $CMAKE_FLAGS += "-DUSE_BASELINE_BUILD=ON"
}

if (Get-Command sccache -ErrorAction SilentlyContinue) {
  Write-Host "Using sccache"

  # Continue with local compiler if sccache has an error
  $env:SCCACHE_IGNORE_SERVER_IO_ERROR = "1"

  $CMAKE_FLAGS += "-DCMAKE_C_COMPILER_LAUNCHER=sccache"
  $CMAKE_FLAGS += "-DCMAKE_CXX_COMPILER_LAUNCHER=sccache"
  $CMAKE_FLAGS += "-DCMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded"
  $CMAKE_FLAGS += "-DCMAKE_POLICY_CMP0141=NEW"
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
    $commandArgs = @($args[1..($args.Count - 1)] | % {$_})
  }

  write-host "> $command $commandArgs"
  & $command $commandArgs
  $result = $LASTEXITCODE

  if ($result -ne 0) {
    throw "$command $commandArgs exited with code $result."
  }
}