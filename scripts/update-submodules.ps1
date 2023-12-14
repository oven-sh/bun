$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
Push-Location (Join-Path $ScriptDir '..')
try {
  $Names = Get-Content .gitmodules | Select-String 'path = (.*)' | ForEach-Object { $_.Matches.Groups[1].Value }

  # we will exclude webkit unless you explicity clone it yourself (a huge download)
  if (-not (Test-Path "src/bun.js/WebKit/.git")) {
    $Names = $Names | Where-Object { $_ -ne 'src/bun.js/WebKit' }
  }

  git submodule update --init --recursive --progress --depth 1 --checkout @NAMES
  if ($LASTEXITCODE -ne 0) {
    throw "git submodule update failed"
  }
} finally { Pop-Location }