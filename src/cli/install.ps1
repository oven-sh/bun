#!/usr/bin/env pwsh
param(
  # TODO: change this to 'latest' when Bun for Windows is stable.
  [string]$Version = "canary"
);

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

Write-Warning "Bun for Windows is currently experimental.`nFor a more stable experience, please install Bun within WSL (https://bun.sh/docs/installation)`n`n"

$BunRoot = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { "${Home}\.bun" }
$BunBin = mkdir -Force "${BunRoot}\bin"

$Target = "bun-windows-64"
$BaseURL = "https://github.com/oven-sh/bun/releases"
$URL = "$BaseURL/$(if ($Version -eq "latest") { "latest/download" } else { "download/$Version" })/$Target.zip"

$ZipPath = "${BunBin}\$Target.zip"

$DisplayVersion = $(
  if ($Version -eq "latest") { "Bun" }
  elseif ($Version -eq "canary") { "Bun Canary" }
  elseif ($Version -match "^bun-v\d+\.\d+\.\d+$") { "Bun $($Version.Substring(4))" }
  else { "Bun tag='${Version}'" }
)

try {
  Invoke-WebRequest $URL -OutFile $ZipPath
}
catch {
  Write-Output "Install Failed:"
  if ($_.ErrorDetails.Message -like "Not Found") {
    Write-Output "${DisplayVersion} is not available for Windows x64`n"
    exit 1
  }
  exit 1
}
if (!(Test-Path $ZipPath)) {
  Write-Output "Install Failed - could not download $URL"
  Write-Output "The file '$ZipPath' does not exist. Did an antivirus delete it?`n"
  exit 1
}
Expand-Archive $ZipPath $BunBin -Force
if (!(Test-Path "${BunBin}\$Target\bun.exe")) {
  Write-Output "Install Failed - could not unzip $ZipPath"
  Write-Output "The file '${BunBin}\$Target\bun.exe' does not exist. Did an antivirus delete it?`n"
  exit 1
}
Move-Item "${BunBin}\$Target\bun.exe" "${BunBin}\bun\bun.exe" -Force

Remove-Item "${BunBin}\$Target" -Recurse -Force
Remove-Item $ZipPath -Force

$BunRevision = "$(& "${BunBin}\bun\bun.exe" --revision)"

if ($LASTEXITCODE -ne 0) {
  Write-Output "Install Failed - could not verify bun.exe"
  Write-Output "The command '${BunBin}\bun\bun.exe --revision' exited with code ${LASTEXITCODE}`n"
  exit 1
}

$User = [System.EnvironmentVariableTarget]::User
$Path = [System.Environment]::GetEnvironmentVariable('Path', $User)
if (!(";${Path};".ToLower() -like "*;${BinDir};*".ToLower())) {
  [System.Environment]::SetEnvironmentVariable('Path', "${Path};${BinDir}", $User)
  $Env:Path += ";${BinDir}"
}
Write-Output "Bun ${BunRevision} was successfully installed to ${BunRoot}!"
