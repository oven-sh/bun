$ErrorActionPreference = "Stop" # Setting strict mode, similar to 'set -euo pipefail' in bash

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
  throw "Visual Studio environment is targetting 32 bit. This configuration is definetly a mistake."
}

cmake -B build -GNinja -DCMAKE_BUILD_TYPE=Release -DCMAKE_VERBOSE_MAKEFILE=ON -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }

cmake --build build --verbose
if ($LASTEXITCODE -ne 0) { throw "C++ compilation failed" }
