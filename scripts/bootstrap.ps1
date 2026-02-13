# Version: 13
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
  [switch]$CI = $false,
  [Parameter(Mandatory = $false)]
  [switch]$Optimize = $CI
)

$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$script:IsARM64 = $env:PROCESSOR_ARCHITECTURE -eq "ARM64"

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
  scoop install $Name
  Refresh-Path
}

# ============================================================================
# Scoop packages (native ARM64 binaries)
# ============================================================================

function Install-Git {
  Install-Scoop-Package git

  if ($CI) {
    git config --system --add safe.directory "*"
    git config --system core.autocrlf false
    git config --system core.eol lf
    git config --system core.longpaths true
  }
}

function Install-NodeJs {
  Install-Scoop-Package nodejs -Command node
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
    Write-Output "Installing LLVM $LLVM_VERSION (ARM64 via Scoop)..."
    scoop install "llvm-arm64@$LLVM_VERSION"
  } else {
    Write-Output "Installing LLVM $LLVM_VERSION (x64 via Scoop)..."
    scoop install "llvm@$LLVM_VERSION"
  }
  Refresh-Path
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
  if (Which 7z) {
    return
  }

  if ($script:IsARM64) {
    # Scoop's 7zip ARM64 post_install has a Remove-Item error that kills bootstrap.
    # Install manually instead.
    Write-Output "Installing 7zip (manual ARM64)..."
    $zip = Download-File "https://www.7-zip.org/a/7z2600-arm64.exe" -Name "7z-arm64.exe"
    $dest = "C:\Program Files\7-Zip"
    New-Item -Path $dest -ItemType Directory -Force | Out-Null
    # 7zip ARM64 exe is a self-extracting archive — extract with itself
    Start-Process $zip -ArgumentList "-o`"$dest`" -y" -Wait -NoNewWindow
    Add-To-Path $dest
  } else {
    Install-Scoop-Package 7zip -Command 7z
  }
}

function Install-Make {
  Install-Scoop-Package make
}

function Install-Cygwin {
  # Cygwin's default mirror (mirrors.kernel.org) can be unreachable from Azure.
  # Make this non-fatal — the build will fail later if cygwin is actually needed.
  try {
    Install-Scoop-Package cygwin
    $cygwinBin = Join-Path $env:USERPROFILE "scoop\apps\cygwin\current\bin"
    if (Test-Path $cygwinBin) {
      Add-To-Path $cygwinBin -Scope User
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

  if ($CI) {
    $shellPath = (Which pwsh -Required)
    New-ItemProperty `
      -Path "HKLM:\\SOFTWARE\\OpenSSH" `
      -Name DefaultShell `
      -Value $shellPath `
      -PropertyType String `
      -Force
  }
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

  Write-Output "Installing Bun..."
  $installScript = Download-File "https://bun.sh/install.ps1" -Name "bun-install.ps1"
  $pwsh = Which pwsh powershell -Required
  & $pwsh $installScript
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
}

function Install-Nssm {
  if (Which nssm) {
    return
  }

  # Try Scoop first, fall back to our mirror if nssm.cc is down
  try {
    Install-Scoop-Package nssm
  } catch {
    Write-Output "Scoop install failed, downloading nssm from mirror..."
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

# Manual installs (not in Scoop or need special handling)
Install-Pwsh
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