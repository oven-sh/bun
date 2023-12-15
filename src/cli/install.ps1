#!/usr/bin/env pwsh
param(
  # TODO: change this to 'latest' when Bun for Windows is stable.
  [string]$Version = "canary"
);

$ErrorActionPreference = "Stop"

# filter out 32 bit and arm
if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
  Write-Output "Install Failed:"
  Write-Output "Bun for Windows is only available for 64-bit Windows.`n"
  exit 1
}

# if a semver is given, we need to adjust it to this format: bun-v0.0.0
if ($Version -match "^\d+\.\d+\.\d+$") {
  $Version = "bun-v$Version"
}
elseif ($Version -match "^v\d+\.\d+\.\d+$") {
  $Version = "bun-$Version"
}
# todo: remove this when Bun for Windows is stable
elseif ($Version -eq "latest") {
  $Version = "canary"
}

$BunRoot = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { "${Home}\.bun" }
$BunBin = mkdir -Force "${BunRoot}\bin"

$Target = "bun-windows-x64"
$BaseURL = "https://github.com/oven-sh/bun/releases"
$URL = "$BaseURL/$(if ($Version -eq "latest") { "latest/download" } else { "download/$Version" })/$Target.zip"

$ZipPath = "${BunBin}\$Target.zip"

$DisplayVersion = $(
  if ($Version -eq "latest") { "Bun" }
  elseif ($Version -eq "canary") { "Bun Canary" }
  elseif ($Version -match "^bun-v\d+\.\d+\.\d+$") { "Bun $($Version.Substring(4))" }
  else { "Bun tag='${Version}'" }
)

$null = mkdir -Force $BunBin
Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
curl.exe "-#SfLo" "$ZipPath" "$URL" 
if ($LASTEXITCODE -ne 0) {
  Write-Output "Install Failed - could not download $URL"
  Write-Output "The command 'curl.exe $URL -o $ZipPath' exited with code ${LASTEXITCODE}`n"
  exit 1
}
if (!(Test-Path $ZipPath)) {
  Write-Output "Install Failed - could not download $URL"
  Write-Output "The file '$ZipPath' does not exist. Did an antivirus delete it?`n"
  exit 1
}
try {
  $lastProgressPreference = $global:ProgressPreference
  $global:ProgressPreference = 'SilentlyContinue';
  Expand-Archive "$ZipPath" "$BunBin" -Force
  $global:ProgressPreference = $lastProgressPreference
  if (!(Test-Path "${BunBin}\$Target\bun.exe")) {
    throw "The file '${BunBin}\$Target\bun.exe' does not exist. Did an antivirus delete it?`n"
  }
} catch {
  Write-Output "Install Failed - could not unzip $ZipPath"
  Write-Error $_
  exit 1
}
Move-Item "${BunBin}\$Target\bun.exe" "${BunBin}\bun.exe" -Force

Remove-Item "${BunBin}\$Target" -Recurse -Force
Remove-Item $ZipPath -Force

$BunRevision = "$(& "${BunBin}\bun.exe" --revision)"
if ($LASTEXITCODE -ne 0) {
  Write-Output "Install Failed - could not verify bun.exe"
  Write-Output "The command '${BunBin}\bun.exe --revision' exited with code ${LASTEXITCODE}`n"
  # TODO check for lastexitcode -1073741795 and print a better message
  exit 1
}
$DisplayVersion = if ($BunRevision -like "*-canary.*") {
  "${BunRevision}"
} else {
  "$(& "${BunBin}\bun.exe" --version)"
}

$C_RESET = [char]27 + "[0m"
$C_GREEN = [char]27 + "[1;32m"

try {
  $null = New-Item -ItemType HardLink -Path "${BunBin}\bunx.exe" -Target "${BunBin}\bun.exe" -Force
} catch {
  Write-Warning "Could not create a hard link for bunx, falling back to a cmd script`n"
  Set-Content -Path "${BunBin}\bunx.cmd" -Value "@%~dp0bun.exe x %*"
}

Write-Output "${C_GREEN}Bun ${DisplayVersion} was installed successfully!${C_RESET}"
Write-Output "The binary is located at ${BunBin}\bun.exe`n"

Write-Warning "Bun for Windows is currently experimental.`nFor a more stable experience, please install Bun within WSL:`nhttps://bun.sh/docs/installation`n"

$hasExistingOther = $false;
try {
  $existing = Get-Command bun -ErrorAction
  if ($existing.Source -ne "${BunBin}\bun.exe") {
    Write-Warning "Note: Another bun.exe is already in %PATH% at $($existing.Source)`nTyping 'bun' in your terminal will not use what was just installed.`n"
    $hasExistingOther = $true;
  }
} catch {}

$User = [System.EnvironmentVariableTarget]::User
$Path = [System.Environment]::GetEnvironmentVariable('Path', $User) -split ';'
if ($Path -notcontains $BunBin) {
  $Path += $BunBin
  [System.Environment]::SetEnvironmentVariable('Path', $Path -join ';', $User)
}
if ($env:PATH -notcontains ";${BunBin}") {
  $env:PATH = "${env:Path};${BunBin}"
}

if(!$hasExistingOther) {
  if((Get-Command -ErrorAction SilentlyContinue bun) -eq $null) {
    Write-Output "To get started, restart your terminal session, then type `"bun`"`n"
  } else {
    Write-Output "Type `"bun`" in your terminal to get started`n"
  }
}
