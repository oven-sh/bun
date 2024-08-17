# This script builds bun and its dependencies on Windows.
# Also see: scripts/build.mjs
$ErrorActionPreference = "Stop"

if ($env:VSINSTALLDIR -eq $null) {
  Write-Host "Loading Visual Studio environment, this may take a second..."

  $vsWhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  if (!(Test-Path $vsWhere)) {
    throw "Visual Studio installer not found: $vsWhere"
  }

  $vsDir = (& $vsWhere -prerelease -latest -property installationPath)
  if ($vsDir -eq $null) {
    $vsDir = Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022" -Directory
    if ($vsDir -eq $null) {
      throw "Visual Studio directory not found: $vsDir"
    }
    $vsDir = $vsDir.FullName
  }

  $vsDevShell = Join-Path -Path $vsDir -ChildPath "Common7\Tools\Launch-VsDevShell.ps1"
  if (!(Test-Path $vsDevShell)) {
    throw "Visual Studio dev shell not found: $vsDevShell"
  }

  . $vsDevShell -Arch amd64 -HostArch amd64
}

if ($env:VSCMD_ARG_TGT_ARCH -eq "x86") {
  throw "Visual Studio is targetting a 32 bit architecture, which is not supported. Switch to a 64 bit architecture."
}

$scriptsDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$buildScript = Join-Path -Path $scriptsDir -ChildPath "build.mjs"
if (!(Test-Path $buildScript)) {
  throw "Build script not found: $buildScript"
}

$cwd = Split-Path -Path $scriptsDir -Parent
Push-Location $cwd

Write-Host "> $buildScript $args"
. node $buildScript $args

Pop-Location
exit $LASTEXITCODE
