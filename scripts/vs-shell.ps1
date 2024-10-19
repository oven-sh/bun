# Ensures that commands run in a Visual Studio environment.
# This is required to run commands like cmake and ninja on Windows.

$ErrorActionPreference = "Stop"

if($env:VSINSTALLDIR -eq $null) {
  Write-Host "Loading Visual Studio environment, this may take a second..."

  $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  if (!(Test-Path $vswhere)) {
    throw "Command not found: vswhere (did you install Visual Studio?)"
  }

  $vsDir = (& $vswhere -prerelease -latest -property installationPath)
  if ($vsDir -eq $null) {
    $vsDir = Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022" -Directory
    if ($vsDir -eq $null) {
      throw "Visual Studio directory not found."
    }
    $vsDir = $vsDir.FullName
  }

  Push-Location $vsDir
  try {
    $vsShell = (Join-Path -Path $vsDir -ChildPath "Common7\Tools\Launch-VsDevShell.ps1")
    . $vsShell -Arch amd64 -HostArch amd64
  } finally {
    Pop-Location
  }
}

if($env:VSCMD_ARG_TGT_ARCH -eq "x86") {
  throw "Visual Studio environment is targeting 32 bit, but only 64 bit is supported."
}

if ($args.Count -gt 0) {
  $command = $args[0]
  $commandArgs = @()
  if ($args.Count -gt 1) {
    $commandArgs = @($args[1..($args.Count - 1)] | % {$_})
  }

  Write-Host "$ $command $commandArgs"
  & $command $commandArgs
  exit $LASTEXITCODE
}
