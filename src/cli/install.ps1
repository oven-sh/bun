#!/usr/bin/env pwsh
param(
  # TODO: change this to 'latest' when Bun for Windows is stable.
  [string]$Version = "canary"
);

$ErrorActionPreference = "Stop"

# This is a functions so that in the unlikely case the baseline check fails but is is needed, we can do a recursive call.
# There are also lots of sanity checks out of fear of anti-virus software or other weird Windows things happening.
function Install-Bun {
  param(
    [string]$Version
    [bool]$ForceBaseline = $False
  );

  # filter out 32 bit and arm
  if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
    Write-Output "Install Failed:"
    Write-Output "Bun for Windows is only available for x86 64-bit Windows.`n"
    exit 1
  }

  # .win10_rs5
  $MinBuild = 17763;
  $MinBuildName = "Windows 10 1809"
  $WinVer = [System.Environment]::OSVersion.Version
  if ($WinVer.Major -lt 10 -or ($WinVer.Major -eq 10 -and $WinVer.Build -lt $MinBuild)) {
    Write-Warning "Bun requires at $($MinBuildName) or newer.`n`nThe install will still continue but it may not work.`n"
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

  $Arch = "x64"
  $IsBaseline = $ForceBaseline

  $EnabledXStateFeatures = ( `
    Add-Type -MemberDefinition '[DllImport("kernel32.dll")]public static extern long GetEnabledXStateFeatures();' `
      -Name 'Kernel32' -Namespace 'Win32' -PassThru `
  )::GetEnabledXStateFeatures();
  $IsBaseline = ($EnabledXStateFeatures -band 4) -neq 4;

  $BunRoot = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { "${Home}\.bun" }
  $BunBin = mkdir -Force "${BunRoot}\bin"

  $Target = "bun-windows-$Arch"
  if ($IsBaseline) {
    $Target = "bun-windows-$Arch-baseline"
  }
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
      throw "The file '${BunBin}\$Target\bun.exe' does not exist. Download is corrupt / Antivirus intercepted?`n"
    }
  } catch {
    Write-Output "Install Failed - could not unzip $ZipPath"
    Write-Error $_
    exit 1
  }
  Remove-Item "${BunBin}\bun.exe" -ErrorAction SilentlyContinue
  Move-Item "${BunBin}\$Target\bun.exe" "${BunBin}\bun.exe" -Force

  Remove-Item "${BunBin}\$Target" -Recurse -Force
  Remove-Item $ZipPath -Force

  $BunRevision = "$(& "${BunBin}\bun.exe" --revision)"
  if ($LASTEXITCODE -eq 1073741795) { # STATUS_ILLEGAL_INSTRUCTION
    if ($IsBaseline) {
      Write-Output "Install Failed - bun.exe (baseline) is not compatible with your CPU.`n"
      Write-Output "Please open a GitHub issue with your CPU model:`nhttps://github.com/oven-sh/bun/issues/new/choose`n"
      exit 1
    }

    Write-Output "Install Failed - bun.exe is not compatible with your CPU. This should have been detected before downloading.`n"
    Write-Output "Attempting to download bun.exe (baseline) instead.`n"

    Install-Bun -Version $Version -ForceBaseline $True
    exit 1
  }
  if (($LASTEXITCODE -eq 3221225781) # STATUS_DLL_NOT_FOUND
  # https://discord.com/channels/876711213126520882/1149339379446325248/1205194965383250081
  # http://community.sqlbackupandftp.com/t/error-1073741515-solved/1305
  || ($LASTEXITCODE -eq 1073741515))
  { 
    Write-Output "Install Failed - You are missing a DLL required to run bun.exe"
    Write-Output "This can be solved by installing the Visual C++ Redistributable from Microsoft:`nSee https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist`nDirect Download -> https://aka.ms/vs/17/release/vc_redist.x64.exe`n`n"
    Write-Output "The command '${BunBin}\bun.exe --revision' exited with code ${LASTEXITCODE}`n"
    exit 1
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Output "Install Failed - could not verify bun.exe"
    Write-Output "The command '${BunBin}\bun.exe --revision' exited with code ${LASTEXITCODE}`n"
    exit 1
  }
  $DisplayVersion = if ($BunRevision -like "*-canary.*") {
    "${BunRevision}"
  } else {
    "$(& "${BunBin}\bun.exe" --version)"
  }

  $C_RESET = [char]27 + "[0m"
  $C_GREEN = [char]27 + "[1;32m"

  # delete bunx if it exists already. this happens if you re-install
  # we don't want to hit an "already exists" error.
  Remove-Item "${BunBin}\bunx.exe" -ErrorAction SilentlyContinue
  Remove-Item "${BunBin}\bunx.cmd" -ErrorAction SilentlyContinue

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
    Write-Output "To get started, restart your terminal/editor, then type `"bun`"`n"
  }
}