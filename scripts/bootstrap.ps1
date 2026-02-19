# Version: 14
# A script that installs the dependencies needed to build and test Bun on Windows.
# Supports both x64 and ARM64 using Scoop for package management.
# Used by Azure [build images] pipeline.

# If this script does not work on your machine, please open an issue:
# https://github.com/oven-sh/bun/issues

# If you need to make a change to this script, such as upgrading a dependency,
# increment the version comment to indicate that a new image should be built.
# Otherwise, the existing image will be retroactively updated.

param (
  [Parameter(Mandatory = $false)]
  [switch]$CI = ($env:CI -eq "true"),
  [Parameter(Mandatory = $false)]
  [switch]$Optimize = $CI
)

$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# Detect ARM64 from registry (works even under x64 emulation)
$realArch = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').PROCESSOR_ARCHITECTURE
$script:IsARM64 = $realArch -eq "ARM64"

# If we're on ARM64 but running under x64 emulation, re-launch as native ARM64.
# Azure Run Command uses x64-emulated PowerShell which breaks package installs.
if ($script:IsARM64 -and $env:PROCESSOR_ARCHITECTURE -ne "ARM64") {
  $nativePS = "$env:SystemRoot\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  if (Test-Path $nativePS) {
    Write-Output "Re-launching bootstrap as native ARM64 PowerShell..."
    & $nativePS -NoProfile -ExecutionPolicy Bypass -File $MyInvocation.MyCommand.Path @PSBoundParameters
    exit $LASTEXITCODE
  }
}

# ============================================================================
# Utility functions
# ============================================================================


function Which {
  param ([switch]$Required = $false)

  foreach ($command in $args) {
    $result = Get-Command $command -ErrorAction SilentlyContinue
    if ($result -and $result.Path) {
      return $result.Path
    }
  }

  if ($Required) {
    $commands = $args -join ', '
    throw "Command not found: $commands"
  }
}

function Download-File {
  param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Url,
    [Parameter(Mandatory = $false)]
    [string]$Name,
    [Parameter(Mandatory = $false)]
    [string]$Path
  )

  if (-not $Name) {
    $Name = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetRandomFileName(), [System.IO.Path]::GetExtension($Url))
  }

  if (-not $Path) {
    $Path = "$env:TEMP\$Name"
  }

  $client = New-Object System.Net.WebClient
  for ($i = 0; $i -lt 10 -and -not (Test-Path $Path); $i++) {
    try {
      $client.DownloadFile($Url, $Path)
    } catch {
      Write-Warning "Failed to download $Url, retry $i..."
      Start-Sleep -s $i
    }
  }

  return $Path
}

function Refresh-Path {
  $paths = @(
    [System.Environment]::GetEnvironmentVariable("Path", "Machine"),
    [System.Environment]::GetEnvironmentVariable("Path", "User"),
    [System.Environment]::GetEnvironmentVariable("Path", "Process")
  )
  $uniquePaths = $paths |
    Where-Object { $_ } |
    ForEach-Object { $_.Split(';', [StringSplitOptions]::RemoveEmptyEntries) } |
    Where-Object { $_ -and (Test-Path $_) } |
    Select-Object -Unique
  $env:Path = ($uniquePaths -join ';').TrimEnd(';')
}

function Add-To-Path {
  param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$PathToAdd,
    [Parameter(Mandatory = $false)]
    [ValidateSet("Machine", "User")]
    [string]$Scope = "Machine"
  )

  $absolutePath = Resolve-Path $PathToAdd
  $currentPath = [Environment]::GetEnvironmentVariable("Path", $Scope)
  if ($currentPath -like "*$absolutePath*") {
    return
  }

  $newPath = $currentPath.TrimEnd(";") + ";" + $absolutePath
  if ($newPath.Length -ge 2048) {
    Write-Warning "PATH is too long, removing duplicate and old entries..."

    $paths = $currentPath.Split(';', [StringSplitOptions]::RemoveEmptyEntries) |
      Where-Object { $_ -and (Test-Path $_) } |
      Select-Object -Unique

    $paths += $absolutePath
    $newPath = $paths -join ';'
    while ($newPath.Length -ge 2048 -and $paths.Count -gt 1) {
      $paths = $paths[1..$paths.Count]
      $newPath = $paths -join ';'
    }
  }

  Write-Output "Adding $absolutePath to PATH ($Scope)..."
  [Environment]::SetEnvironmentVariable("Path", "$newPath", $Scope)
  Refresh-Path
}

function Set-Env {
  param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,
    [Parameter(Mandatory = $true, Position = 1)]
    [string]$Value
  )

  Write-Output "Setting environment variable $Name=$Value..."
  [System.Environment]::SetEnvironmentVariable("$Name", "$Value", "Machine")
  [System.Environment]::SetEnvironmentVariable("$Name", "$Value", "Process")
}

# ============================================================================
# Scoop — ARM64-native package manager
# ============================================================================

function Install-Scoop {
  if (Which scoop) {
    return
  }

  Write-Output "Installing Scoop..."
  # Scoop blocks admin installs unless -RunAsAdmin is passed.
  # Install to a known global location so all users can access it.
  $env:SCOOP = "C:\Scoop"
  [Environment]::SetEnvironmentVariable("SCOOP", $env:SCOOP, "Machine")
  iex "& {$(irm get.scoop.sh)} -RunAsAdmin -ScoopDir C:\Scoop"
  Add-To-Path "C:\Scoop\shims"
  Refresh-Path
  Write-Output "Scoop version: $(scoop --version)"
}

function Install-Scoop-Package {
  param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,
    [Parameter(Mandatory = $false)]
    [string]$Command = $Name
  )

  if (Which $Command) {
    return
  }

  Write-Output "Installing $Name (via Scoop)..."
  # Scoop post_install scripts can have non-fatal Remove-Item errors
  # (e.g. 7zip ARM64 7zr.exe locked, llvm-arm64 missing Uninstall.exe).
  # Suppress all error streams so they don't kill the bootstrap or Packer.
  $prevErrorPref = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  scoop install $Name *>&1 | ForEach-Object { "$_" } | Write-Host
  $ErrorActionPreference = $prevErrorPref
  Refresh-Path
}

# ============================================================================
# Scoop packages (native ARM64 binaries)
# ============================================================================

function Install-Git {
  Install-Scoop-Package git

  # Git for Windows ships Unix tools (cat, head, tail, etc.) in usr\bin
  $gitUsrBin = "C:\Scoop\apps\git\current\usr\bin"
  if (Test-Path $gitUsrBin) {
    Add-To-Path $gitUsrBin
  }

  if ($CI) {
    git config --system --add safe.directory "*"
    git config --system core.autocrlf false
    git config --system core.eol lf
    git config --system core.longpaths true
  }
}

function Install-NodeJs {
  # Pin to match the ABI version Bun expects (NODE_MODULE_VERSION 137).
  # Latest Node (25.x) uses ABI 141 which breaks node-gyp tests.
  Install-Scoop-Package "nodejs@24.3.0" -Command node
}

function Install-CMake {
  Install-Scoop-Package cmake
}

function Install-Llvm {
  $LLVM_VERSION = "21.1.8"
  if (Which clang-cl) {
    return
  }
  if ($script:IsARM64) {
    Install-Scoop-Package "llvm-arm64@$LLVM_VERSION" -Command clang-cl
  } else {
    Install-Scoop-Package "llvm@$LLVM_VERSION" -Command clang-cl
  }
}

function Install-Ninja {
  Install-Scoop-Package ninja
}

function Install-Python {
  Install-Scoop-Package python
}

function Install-Go {
  Install-Scoop-Package go
}

function Install-Ruby {
  Install-Scoop-Package ruby
}

function Install-7zip {
  Install-Scoop-Package 7zip -Command 7z
}

function Install-Make {
  Install-Scoop-Package make
}

function Install-Cygwin {
  # Cygwin's default mirror (mirrors.kernel.org) can be unreachable from Azure.
  # Make this non-fatal — the build will fail later if cygwin is actually needed.
  try {
    Install-Scoop-Package cygwin
    # Cygwin binaries are at <scoop>/apps/cygwin/current/root/bin
    $cygwinBin = "C:\Scoop\apps\cygwin\current\root\bin"
    if (Test-Path $cygwinBin) {
      Add-To-Path $cygwinBin  # Machine scope (default) — survives Sysprep
    }
  } catch {
    Write-Warning "Cygwin installation failed (non-fatal): $_"
  }
}

# ============================================================================
# Manual installs (not available or not ideal via Scoop)
# ============================================================================

function Install-Pwsh {
  if (Which pwsh) {
    return
  }

  $pwshArch = if ($script:IsARM64) { "arm64" } else { "x64" }
  Write-Output "Installing PowerShell Core ($pwshArch)..."
  $msi = Download-File "https://github.com/PowerShell/PowerShell/releases/download/v7.5.2/PowerShell-7.5.2-win-$pwshArch.msi" -Name "pwsh-$pwshArch.msi"
  $process = Start-Process msiexec -ArgumentList "/i `"$msi`" /quiet /norestart ADD_PATH=1" -Wait -PassThru -NoNewWindow
  if ($process.ExitCode -ne 0) {
    throw "Failed to install PowerShell: code $($process.ExitCode)"
  }
  Remove-Item $msi -ErrorAction SilentlyContinue
  Refresh-Path
}

function Install-OpenSSH {
  $sshdService = Get-Service -Name sshd -ErrorAction SilentlyContinue
  if ($sshdService) {
    return
  }

  Write-Output "Installing OpenSSH Server..."
  # Add-WindowsCapability requires DISM elevation which isn't available in Packer's
  # WinRM session. Download and install from GitHub releases instead.
  $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "Arm64" } else { "Win64" }
  $url = "https://github.com/PowerShell/Win32-OpenSSH/releases/download/v9.8.1.0p1-Preview/OpenSSH-${arch}.zip"
  $zip = "$env:TEMP\OpenSSH.zip"
  $dest = "$env:ProgramFiles\OpenSSH"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath "$env:TEMP\OpenSSH" -Force
  New-Item -Path $dest -ItemType Directory -Force | Out-Null
  $extractedDir = Get-ChildItem -Path "$env:TEMP\OpenSSH" -Directory | Select-Object -First 1
  Get-ChildItem -Path $extractedDir.FullName -Recurse | Move-Item -Destination $dest -Force
  & "$dest\install-sshd.ps1"
  & "$dest\FixHostFilePermissions.ps1" -Confirm:$false
  Remove-Item $zip, "$env:TEMP\OpenSSH" -Recurse -Force -ErrorAction SilentlyContinue

  # Configure sshd to start on boot (don't start now — host keys may not exist yet during image build)
  Set-Service -Name sshd -StartupType Automatic

  # Set default shell to pwsh
  $pwshPath = (Which pwsh -ErrorAction SilentlyContinue)
  if (-not $pwshPath) { $pwshPath = (Which powershell) }
  if ($pwshPath) {
    New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
      -Value $pwshPath -PropertyType String -Force
  }

  # Firewall rule for port 22
  $rule = Get-NetFirewallRule -Name "OpenSSH-Server" -ErrorAction SilentlyContinue
  if (-not $rule) {
    New-NetFirewallRule -Profile Any -Name "OpenSSH-Server" `
      -DisplayName "OpenSSH Server (sshd)" -Enabled True `
      -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
  }

  # Configure sshd_config for key-based auth
  $sshdConfigPath = "C:\ProgramData\ssh\sshd_config"
  if (Test-Path $sshdConfigPath) {
    $config = Get-Content $sshdConfigPath
    $config = $config -replace '#PubkeyAuthentication yes', 'PubkeyAuthentication yes'
    $config = $config -replace 'PasswordAuthentication yes', 'PasswordAuthentication no'
    Set-Content -Path $sshdConfigPath -Value $config
  }

  Write-Output "OpenSSH Server installed and configured"

  # Register a startup task that fetches oven-sh GitHub org members' SSH keys
  # on every boot so any bun dev can SSH in.
  $fetchScript = @'
try {
  $members = Invoke-RestMethod -Uri "https://api.github.com/orgs/oven-sh/members" -Headers @{ "User-Agent" = "bun-ci" }
  $keys = @()
  foreach ($member in $members) {
    if ($member.type -ne "User" -or -not $member.login) { continue }
    try {
      $userKeys = (Invoke-WebRequest -Uri "https://github.com/$($member.login).keys" -UseBasicParsing).Content
      if ($userKeys) { $keys += $userKeys.Trim() }
    } catch { }
  }
  if ($keys.Count -gt 0) {
    $keysPath = "C:\ProgramData\ssh\administrators_authorized_keys"
    Set-Content -Path $keysPath -Value ($keys -join "`n") -Force
    icacls $keysPath /inheritance:r /grant "SYSTEM:(F)" /grant "Administrators:(R)" | Out-Null
  }
} catch { }
'@
  $scriptPath = "C:\ProgramData\ssh\fetch-ssh-keys.ps1"
  Set-Content -Path $scriptPath -Value $fetchScript -Force
  $action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName "FetchSshKeys" -Action $action -Trigger $trigger `
    -Settings $settings -User "SYSTEM" -RunLevel Highest -Force
  Write-Output "Registered FetchSshKeys startup task"
}

function Install-Ccache {
  if (Which ccache) {
    return
  }

  $version = "4.12.2"
  $archSuffix = if ($script:IsARM64) { "aarch64" } else { "x86_64" }
  Write-Output "Installing ccache $version ($archSuffix)..."
  $zip = Download-File "https://github.com/ccache/ccache/releases/download/v$version/ccache-$version-windows-$archSuffix.zip" -Name "ccache-$archSuffix.zip"
  $extractDir = "$env:TEMP\ccache-extract"
  Expand-Archive $zip $extractDir -Force
  $installDir = "$env:ProgramFiles\ccache"
  New-Item -Path $installDir -ItemType Directory -Force | Out-Null
  Copy-Item "$extractDir\ccache-$version-windows-$archSuffix\*" $installDir -Recurse -Force
  Remove-Item $zip -ErrorAction SilentlyContinue
  Remove-Item $extractDir -Recurse -ErrorAction SilentlyContinue
  Add-To-Path $installDir
}

function Install-Bun {
  if (Which bun) {
    return
  }

  if ($script:IsARM64) {
    # No published ARM64 bun binary yet — download from our blob storage
    Write-Output "Installing Bun (ARM64 from blob storage)..."
    $zip = Download-File "https://buncistore.blob.core.windows.net/artifacts/bun-windows-aarch64.zip" -Name "bun-arm64.zip"
    $extractDir = "$env:TEMP\bun-arm64"
    Expand-Archive -Path $zip -DestinationPath $extractDir -Force
    $bunExe = Get-ChildItem $extractDir -Recurse -Filter "*.exe" | Where-Object { $_.Name -match "bun" } | Select-Object -First 1
    if ($bunExe) {
      Copy-Item $bunExe.FullName "C:\Windows\System32\bun.exe" -Force
      Write-Output "Bun ARM64 installed to C:\Windows\System32\bun.exe"
    } else {
      throw "Failed to find bun executable in ARM64 zip"
    }
  } else {
    Write-Output "Installing Bun..."
    $installScript = Download-File "https://bun.sh/install.ps1" -Name "bun-install.ps1"
    $pwsh = Which pwsh powershell -Required
    & $pwsh $installScript
    Refresh-Path
    # Copy to System32 so it survives Sysprep (user profile PATH is lost)
    $bunPath = Which bun
    if ($bunPath) {
      Copy-Item $bunPath "C:\Windows\System32\bun.exe" -Force
      Write-Output "Bun copied to C:\Windows\System32\bun.exe"
    }
  }
}

function Install-Rust {
  if (Which rustc) {
    return
  }

  $rustPath = Join-Path $env:ProgramFiles "Rust"
  if (-not (Test-Path $rustPath)) {
    New-Item -Path $rustPath -ItemType Directory | Out-Null
  }

  # Set install paths before running rustup so it installs directly
  # to Program Files (avoids issues with SYSTEM user profile path)
  $env:CARGO_HOME = "$rustPath\cargo"
  $env:RUSTUP_HOME = "$rustPath\rustup"

  Write-Output "Installing Rustup..."
  $rustupInit = Download-File "https://win.rustup.rs/" -Name "rustup-init.exe"

  Write-Output "Installing Rust..."
  & $rustupInit -y

  Write-Output "Setting environment variables for Rust..."
  Set-Env "CARGO_HOME" "$rustPath\cargo"
  Set-Env "RUSTUP_HOME" "$rustPath\rustup"
  Add-To-Path "$rustPath\cargo\bin"
}

function Install-Visual-Studio {
  param (
    [Parameter(Mandatory = $false)]
    [string]$Edition = "community"
  )

  Write-Output "Downloading Visual Studio installer..."
  $vsInstaller = Download-File "https://aka.ms/vs/17/release/vs_$Edition.exe"

  Write-Output "Installing Visual Studio..."
  $vsInstallArgs = @(
    "--passive",
    "--norestart",
    "--wait",
    "--force",
    "--locale en-US",
    "--add Microsoft.VisualStudio.Workload.NativeDesktop",
    "--includeRecommended"
  )
  $process = Start-Process $vsInstaller -ArgumentList ($vsInstallArgs -join ' ') -Wait -PassThru -NoNewWindow
  # Exit code 3010 means "reboot required" which is not a real error
  if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
    throw "Failed to install Visual Studio: code $($process.ExitCode)"
  }
}

function Install-PdbAddr2line {
  cargo install --examples "pdb-addr2line@0.11.2"
  # Also copy to System32 so it's always on PATH (like bun.exe)
  $src = Join-Path $env:CARGO_HOME "bin\pdb-addr2line.exe"
  if (Test-Path $src) {
    Copy-Item $src "C:\Windows\System32\pdb-addr2line.exe" -Force
    Write-Output "pdb-addr2line copied to C:\Windows\System32"
  }
}

function Install-Nssm {
  if (Which nssm) {
    return
  }

  # Try Scoop first, fall back to our mirror if nssm.cc is down (503 errors)
  Install-Scoop-Package nssm

  if (-not (Which nssm)) {
    Write-Output "Scoop install of nssm failed, downloading from mirror..."
    $zip = Download-File "https://buncistore.blob.core.windows.net/artifacts/nssm-2.24-103-gdee49fc.zip" -Name "nssm.zip"
    Expand-Archive -Path $zip -DestinationPath "C:\Windows\Temp\nssm" -Force
    $nssm = Get-ChildItem "C:\Windows\Temp\nssm" -Recurse -Filter "nssm.exe" | Where-Object { $_.DirectoryName -like "*win64*" } | Select-Object -First 1
    if ($nssm) {
      Copy-Item $nssm.FullName "C:\Windows\System32\nssm.exe" -Force
      Write-Output "nssm installed to C:\Windows\System32\nssm.exe"
    } else {
      throw "Failed to install nssm"
    }
  }
}

# ============================================================================
# Buildkite
# ============================================================================

function Create-Buildkite-Environment-Hooks {
  param (
    [Parameter(Mandatory = $true)]
    [string]$BuildkiteHome
  )

  Write-Output "Creating Buildkite environment hooks..."
  $hooksDir = Join-Path $BuildkiteHome "hooks"

  if (-not (Test-Path $hooksDir)) {
    New-Item -Path $hooksDir -ItemType Directory -Force | Out-Null
  }

  $environmentHook = Join-Path $hooksDir "environment.ps1"
  $buildPath = Join-Path $BuildkiteHome "build"

  @"
# Buildkite environment hook
`$env:BUILDKITE_BUILD_CHECKOUT_PATH = "$buildPath"
"@ | Set-Content -Path $environmentHook -Encoding UTF8

  Write-Output "Environment hook created at $environmentHook"

  # pre-exit hook: logout from Tailscale so ephemeral nodes are removed
  # instantly instead of waiting 30-60 minutes. This runs after the job
  # finishes, which is after the SSH user wait loop in runner.node.mjs.
  $preExitHook = Join-Path $hooksDir "pre-exit.ps1"
  @"
if (Test-Path "C:\Program Files\Tailscale\tailscale.exe") {
  & "C:\Program Files\Tailscale\tailscale.exe" logout 2>`$null
}
"@ | Set-Content -Path $preExitHook -Encoding UTF8
  Write-Output "Pre-exit hook created at $preExitHook"
}

function Install-Buildkite {
  if (Which buildkite-agent) {
    return
  }

  Write-Output "Installing Buildkite agent..."
  $env:buildkiteAgentToken = "xxx"
  $installScript = Download-File "https://raw.githubusercontent.com/buildkite/agent/main/install.ps1"
  $pwsh = Which pwsh powershell -Required
  & $pwsh $installScript
  Refresh-Path

  if ($CI) {
    $buildkiteHome = "C:\buildkite-agent"
    if (-not (Test-Path $buildkiteHome)) {
      New-Item -Path $buildkiteHome -ItemType Directory -Force | Out-Null
    }
    Create-Buildkite-Environment-Hooks -BuildkiteHome $buildkiteHome
  }
}

# ============================================================================
# System optimization
# ============================================================================

function Optimize-System {
  Disable-Windows-Defender
  Disable-Windows-Threat-Protection
  Disable-Windows-Services
  Disable-Power-Management
}

function Optimize-System-Needs-Reboot {
  Uninstall-Windows-Defender
}

function Disable-Windows-Defender {
  Write-Output "Disabling Windows Defender..."
  Set-MpPreference -DisableRealtimeMonitoring $true
  Add-MpPreference -ExclusionPath "C:\", "D:\"
}

function Disable-Windows-Threat-Protection {
  $itemPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Advanced Threat Protection"
  if (Test-Path $itemPath) {
    Write-Output "Disabling Windows Threat Protection..."
    Set-ItemProperty -Path $itemPath -Name "ForceDefenderPassiveMode" -Value 1 -Type DWORD
  }
}

function Uninstall-Windows-Defender {
  # Requires a reboot — run before the windows-restart Packer provisioner.
  if (Get-Command Uninstall-WindowsFeature -ErrorAction SilentlyContinue) {
    Write-Output "Uninstalling Windows Defender..."
    Uninstall-WindowsFeature -Name Windows-Defender
  }
}

function Disable-Windows-Services {
  $services = @(
    "WSearch",          # Windows Search
    "wuauserv",         # Windows Update
    "DiagTrack",        # Connected User Experiences and Telemetry
    "dmwappushservice", # WAP Push Message Routing Service
    "PcaSvc",           # Program Compatibility Assistant
    "SysMain"           # Superfetch
  )

  foreach ($service in $services) {
    try {
      Stop-Service $service -Force -ErrorAction SilentlyContinue
      Set-Service $service -StartupType Disabled -ErrorAction SilentlyContinue
    } catch {
      Write-Warning "Could not disable service: $service"
    }
  }
}

function Disable-Power-Management {
  Write-Output "Disabling Power Management..."
  powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c # High performance
  powercfg /change monitor-timeout-ac 0
  powercfg /change monitor-timeout-dc 0
  powercfg /change standby-timeout-ac 0
  powercfg /change standby-timeout-dc 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /change hibernate-timeout-dc 0
}

# ============================================================================
# Main
# ============================================================================

if ($Optimize) {
  Optimize-System
}

# Scoop package manager
Install-Scoop

# Packages via Scoop (native ARM64 or x64 depending on architecture)
# 7zip must be installed before git — git depends on 7zip via Scoop,
# and 7zip's post_install has a cleanup error on ARM64 SYSTEM context.
Install-7zip
Install-Git
Install-NodeJs
Install-CMake
Install-Ninja
Install-Python
Install-Go
Install-Ruby
Install-Make
Install-Llvm
Install-Cygwin
Install-Nssm
Install-Scoop-Package perl

# x64-only packages (not needed on ARM64)
if (-not $script:IsARM64) {
  Install-Scoop-Package nasm
  Install-Scoop-Package mingw -Command gcc
}

function Install-Tailscale {
  if (Which tailscale -ErrorAction SilentlyContinue) {
    return
  }

  Write-Output "Installing Tailscale..."
  $msi = "$env:TEMP\tailscale-setup.msi"
  $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
  Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-${arch}.msi" -OutFile $msi -UseBasicParsing
  Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait
  Remove-Item $msi -ErrorAction SilentlyContinue
  Refresh-Path
  Write-Output "Tailscale installed"

  # Register a startup task that reads the tailscale authkey from Azure IMDS
  # tags and joins the tailnet. The key is set by robobun as a VM tag.
  $joinScript = @'
try {
  $headers = @{ "Metadata" = "true" }
  $response = Invoke-RestMethod -Uri "http://169.254.169.254/metadata/instance/compute/tagsList?api-version=2021-02-01" -Headers $headers
  $authkey = ($response | Where-Object { $_.name -eq "tailscale:authkey" }).value
  if ($authkey) {
    $stepKey = ($response | Where-Object { $_.name -eq "buildkite:step-key" }).value
    $buildNumber = ($response | Where-Object { $_.name -eq "buildkite:build-number" }).value
    if ($stepKey) {
      $hostname = "azure-${stepKey}"
      if ($buildNumber) { $hostname += "-${buildNumber}" }
    } else {
      $hostname = (Invoke-RestMethod -Uri "http://169.254.169.254/metadata/instance/compute/name?api-version=2021-02-01&format=text" -Headers $headers)
    }
    & "C:\Program Files\Tailscale\tailscale.exe" up --authkey=$authkey --hostname=$hostname --unattended
  }
} catch { }
'@
  $scriptPath = "C:\ProgramData\tailscale-join.ps1"
  Set-Content -Path $scriptPath -Value $joinScript -Force
  $action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName "TailscaleJoin" -Action $action -Trigger $trigger `
    -Settings $settings -User "SYSTEM" -RunLevel Highest -Force
  Write-Output "Registered TailscaleJoin startup task"
}

# Manual installs (not in Scoop or need special handling)
Install-Pwsh
Install-OpenSSH
#Install-Tailscale  # Disabled — Tailscale adapter interferes with IPv6 multicast tests (node-dgram)
Install-Bun
Install-Ccache
Install-Rust
Install-Visual-Studio
Install-PdbAddr2line

if ($CI) {
  Install-Buildkite
}

if ($Optimize) {
  Optimize-System-Needs-Reboot
}