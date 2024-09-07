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
    $launchps = (Join-Path -Path $vsDir -ChildPath "Common7\Tools\Launch-VsDevShell.ps1")
    . $launchps -Arch amd64 -HostArch amd64
  } finally { Pop-Location }
}

if($Env:VSCMD_ARG_TGT_ARCH -eq "x86") {
  # Please do not try to compile Bun for 32 bit. It will not work. I promise.
  throw "Visual Studio environment is targetting 32 bit. This configuration is definetly a mistake."
}

$BUN_BASE_DIR = if ($env:BUN_BASE_DIR) { $env:BUN_BASE_DIR } else { Join-Path $ScriptDir '..' }
$BUN_DEPS_DIR = if ($env:BUN_DEPS_DIR) { $env:BUN_DEPS_DIR } else { Join-Path $BUN_BASE_DIR 'src\deps' }
$BUN_DEPS_OUT_DIR = if ($env:BUN_DEPS_OUT_DIR) { $env:BUN_DEPS_OUT_DIR } else { Join-Path $BUN_BASE_DIR 'build\bun-deps' }

$CPUS = if ($env:CPUS) { $env:CPUS } else { (Get-CimInstance -Class Win32_Processor).NumberOfCores }
$Lto = if ($env:USE_LTO) { $env:USE_LTO -eq "1" } else { $False }
$Baseline = if ($env:USE_BASELINE_BUILD) {
  $env:USE_BASELINE_BUILD -eq "1"
} elseif ($env:BUILDKITE_STEP_KEY -match "baseline") {
  $True
} else {
  $False
}

$CC = "clang-cl"
$CXX = "clang-cl"

$CFLAGS = '/O2 /Z7 /MT /O2 /Ob2 /DNDEBUG /U_DLL'
$CXXFLAGS = '/O2 /Z7 /MT /O2 /Ob2 /DNDEBUG /U_DLL -Xclang -fno-c++-static-destructors'

# libarchive requires zlib headers for gzip compression support. without them, it will attempt to spawn a gzip process
$CFLAGS += " /I$BUN_DEPS_DIR\zlib"

if ($Lto) {
  $CXXFLAGS += " -fuse-ld=lld -flto -Xclang -emit-llvm-bc"
  $CFLAGS += " -fuse-ld=lld -flto -Xclang -emit-llvm-bc"
}

$CPU_NAME = if ($Baseline) { "nehalem" } else { "haswell" };
$env:CPU_TARGET = $CPU_NAME

$CFLAGS += " -march=${CPU_NAME}"
$CXXFLAGS += " -march=${CPU_NAME}"

$Canary = If ($env:CANARY) {
  $env:CANARY
} ElseIf ($env:BUILDKITE -eq "true") {
  (buildkite-agent meta-data get canary)
} Else {
  "1"
}

$CMAKE_FLAGS = @(
  "-GNinja",
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_C_COMPILER=$CC",
  "-DCMAKE_CXX_COMPILER=$CXX",
  "-DCMAKE_C_FLAGS=$CFLAGS",
  "-DCMAKE_CXX_FLAGS=$CXXFLAGS",
  "-DCMAKE_C_FLAGS_RELEASE=$CFLAGS",
  "-DCMAKE_CXX_FLAGS_RELEASE=$CXXFLAGS",
  "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
  "-DCANARY=$Canary"
)

if (Get-Command llvm-lib -ErrorAction SilentlyContinue) { 
  $AR_CMD = Get-Command llvm-lib -ErrorAction SilentlyContinue
  $AR = $AR_CMD.Path
  $env:AR = $AR
  $CMAKE_FLAGS += "-DCMAKE_AR=$AR"
}

$env:CC = "clang-cl"
$env:CXX = "clang-cl"
$env:CFLAGS = $CFLAGS
$env:CXXFLAGS = $CXXFLAGS
$env:CPUS = $CPUS

if ($Baseline) {
  $CMAKE_FLAGS += "-DUSE_BASELINE_BUILD=ON"
}

if ($Lto) {
  $CMAKE_FLAGS += "-DUSE_LTO=ON"
}

if (Get-Command ccache -ErrorAction SilentlyContinue) {
  $CMAKE_FLAGS += "-DCMAKE_C_COMPILER_LAUNCHER=ccache"
  $CMAKE_FLAGS += "-DCMAKE_CXX_COMPILER_LAUNCHER=ccache"
} elseif (Get-Command sccache -ErrorAction SilentlyContinue) {
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