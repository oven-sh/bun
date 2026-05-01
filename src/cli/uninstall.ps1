# This script will remove the Bun installation at the location of this
# script, removing it from %PATH%, deleting caches, and removing it from
# the list of installed programs.
param(
  [switch]$PauseOnError = $false
)

$ErrorActionPreference = "Stop"

# These two environment functions are roughly copied from https://github.com/prefix-dev/pixi/pull/692
# They are used instead of `SetEnvironmentVariable` because of unwanted variable expansions.
function Write-Env {
  param([String]$Key, [String]$Value)

  $RegisterKey = Get-Item -Path 'HKCU:'
  $EnvRegisterKey = $RegisterKey.OpenSubKey('Environment', $true)
  if ($null -eq $Value) {
    $EnvRegisterKey.DeleteValue($Key)
  } else {
    $RegistryValueKind = if ($Value.Contains('%')) {
      [Microsoft.Win32.RegistryValueKind]::ExpandString
    } elseif ($EnvRegisterKey.GetValue($Key)) {
      $EnvRegisterKey.GetValueKind($Key)
    } else {
      [Microsoft.Win32.RegistryValueKind]::String
    }
    $EnvRegisterKey.SetValue($Key, $Value, $RegistryValueKind)
  }
}

function Get-Env {
  param([String] $Key)

  $RegisterKey = Get-Item -Path 'HKCU:'
  $EnvRegisterKey = $RegisterKey.OpenSubKey('Environment')
  $EnvRegisterKey.GetValue($Key, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}

if (-not (Test-Path "${PSScriptRoot}\bin\bun.exe")) {
  Write-Host "bun.exe not found in ${PSScriptRoot}\bin`n`nRefusing to delete this directory as it may.`n`nIf this uninstallation is still intentional, please just manually delete this folder."
  if ($PauseOnError) { pause }
  exit 1
}

function Stop-Bun {
  try {
    Get-Process -Name bun | Where-Object { $_.Path -eq "${PSScriptRoot}\bin\bun.exe" } | Stop-Process -Force
  } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
    # ignore
  } catch {
    Write-Host "There are open instances of bun.exe that could not be automatically closed."
    if ($PauseOnError) { pause }
    exit 1
  }
}

# Remove ~\.bun\bin\bun.exe
try {
  Stop-Bun
  Remove-Item "${PSScriptRoot}\bin\bun.exe" -Force
} catch {
  # Try a second time
  Stop-Bun
  Start-Sleep -Seconds 1
  try {
    Remove-Item "${PSScriptRoot}\bin\bun.exe" -Force
  } catch {
    Write-Host $_
    Write-Host "`n`nCould not delete ${PSScriptRoot}\bin\bun.exe."
    Write-Host "Please close all instances of bun.exe and try again."
    if ($PauseOnError) { pause }
    exit 1
  }
}

# Remove ~\.bun
try {
  Remove-Item "${PSScriptRoot}" -Recurse -Force
} catch {
  Write-Host "Could not delete ${PSScriptRoot}."
  if ($PauseOnError) { pause }
  exit 1
}

# Delete some tempdir files. Do not fail if an error happens here
try {
  Remove-Item "${Temp}\bun-*" -Recurse -Force
} catch {}
try {
  Remove-Item "${Temp}\bunx-*" -Recurse -Force
} catch {}

# Remove Entry from path
try {
  $Path = Get-Env -Key 'Path'
  $Path = $Path -split ';'
  $Path = $Path | Where-Object { $_ -ne "${PSScriptRoot}\bin" }
  Write-Env -Key 'Path' -Value ($Path -join ';')
} catch  {
  Write-Host "Could not remove ${PSScriptRoot}\bin from PATH."
  Write-Error $_
  if ($PauseOnError) { pause }
  exit 1
}

# Remove Entry from Windows Installer, if it is owned by this installation.
try {
  $item = Get-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bun";
  $location = $item.GetValue("InstallLocation");
  if ($location -eq "${PSScriptRoot}") {
    Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bun" -Recurse
  }
} catch {
  # unlucky tbh
}
