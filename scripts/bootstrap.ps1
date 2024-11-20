# Version: 4
# A powershell script that installs the dependencies needed to build and test Bun.
# This should work on Windows 10 or newer.

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

function Execute-Command {
  $command = $args -join ' '
  Write-Output "$ $command"

  & $args[0] $args[1..$args.Length]

  if ((-not $?) -or ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE)) {
    throw "Command failed: $command"
  }
}

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

function Install-Chocolatey {
  if (Which choco) {
    return
  }

  Write-Output "Installing Chocolatey..."
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  iex -Command ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
  Refresh-Path
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

  if ($env:ChocolateyInstall) {
    Import-Module $env:ChocolateyInstall\helpers\chocolateyProfile.psm1 -ErrorAction SilentlyContinue
  }
}

function Add-To-Path {
  $absolutePath = Resolve-Path $args[0]
  $currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
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

  Write-Output "Adding $absolutePath to PATH..."
  [Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")
  Refresh-Path
}

function Install-Package {
  param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,
    [Parameter(Mandatory = $false)]
    [string]$Command = $Name,
    [Parameter(Mandatory = $false)]
    [string]$Version,
    [Parameter(Mandatory = $false)]
    [switch]$Force = $false,
    [Parameter(Mandatory = $false)]
    [string[]]$ExtraArgs = @()
  )

  if (-not $Force `
    -and (Which $Command) `
    -and (-not $Version -or (& $Command --version) -like "*$Version*")) {
    return
  }

  Write-Output "Installing $Name..."
  $flags = @(
    "--yes",
    "--accept-license",
    "--no-progress",
    "--force"
  )
  if ($Version) {
    $flags += "--version=$Version"
  }

  Execute-Command choco install $Name @flags @ExtraArgs
  Refresh-Path
}

function Install-Packages {
  foreach ($package in $args) {
    Install-Package $package
  }
}

function Install-Common-Software {
  Install-Chocolatey
  Install-Pwsh
  Install-Git
  Install-Packages curl 7zip
  Install-NodeJs
  Install-Bun
  Install-Cygwin
  if ($CI) {
    Install-Tailscale
    Install-Buildkite
  }
}

function Install-Pwsh {
  Install-Package powershell-core -Command pwsh

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

function Install-Git {
  Install-Packages git

  if ($CI) {
    Execute-Command git config --system --add safe.directory "*"
    Execute-Command git config --system core.autocrlf false
    Execute-Command git config --system core.eol lf
    Execute-Command git config --system core.longpaths true
  }
}

function Install-NodeJs {
  Install-Package nodejs -Command node -Version "22.9.0"
}

function Install-Bun {
  Install-Package bun -Version "1.1.30"
}

function Install-Cygwin {
  Install-Package cygwin
  Add-To-Path "C:\tools\cygwin\bin"
}

function Install-Tailscale {
  Install-Package tailscale
}

function Install-Buildkite {
  if (Which buildkite-agent) {
    return
  }

  Write-Output "Installing Buildkite agent..."
  $env:buildkiteAgentToken = "xxx"
  iex ((New-Object System.Net.WebClient).DownloadString("https://raw.githubusercontent.com/buildkite/agent/main/install.ps1"))
  Refresh-Path
}

function Install-Build-Essentials {
  # Install-Visual-Studio
  Install-Packages `
    cmake `
    make `
    ninja `
    ccache `
    python `
    golang `
    nasm `
    ruby `
    mingw
  Install-Rust
  Install-Llvm
}

function Install-Visual-Studio {
  $components = @(
    "Microsoft.VisualStudio.Workload.NativeDesktop",
    "Microsoft.VisualStudio.Component.Windows10SDK.18362",
    "Microsoft.VisualStudio.Component.Windows11SDK.22000",
    "Microsoft.VisualStudio.Component.Windows11Sdk.WindowsPerformanceToolkit",
    "Microsoft.VisualStudio.Component.VC.ASAN", # C++ AddressSanitizer
    "Microsoft.VisualStudio.Component.VC.ATL", # C++ ATL for latest v143 build tools (x86 & x64)
    "Microsoft.VisualStudio.Component.VC.DiagnosticTools", # C++ Diagnostic Tools
    "Microsoft.VisualStudio.Component.VC.CLI.Support", # C++/CLI support for v143 build tools (Latest)
    "Microsoft.VisualStudio.Component.VC.CoreIde", # C++ core features
    "Microsoft.VisualStudio.Component.VC.Redist.14.Latest" # C++ 2022 Redistributable Update
  )

  $arch = (Get-WmiObject Win32_Processor).Architecture
  if ($arch -eq 9) {
    $components += @(
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", # MSVC v143 build tools (x86 & x64)
      "Microsoft.VisualStudio.Component.VC.Modules.x86.x64" # MSVC v143 C++ Modules for latest v143 build tools (x86 & x64)
    )
  } elseif ($arch -eq 5) {
    $components += @(
      "Microsoft.VisualStudio.Component.VC.Tools.ARM64", # MSVC v143 build tools (ARM64)
      "Microsoft.VisualStudio.Component.UWP.VC.ARM64" # C++ Universal Windows Platform support for v143 build tools (ARM64/ARM64EC)
    )
  }

  $packageParameters = $components | ForEach-Object { "--add $_" }
  Install-Package visualstudio2022community `
    -ExtraArgs "--package-parameters '--add Microsoft.VisualStudio.Workload.NativeDesktop --includeRecommended --includeOptional'"
}

function Install-Rust {
  if (Which rustc) {
    return
  }

  Write-Output "Installing Rust..."
  $rustupInit = "$env:TEMP\rustup-init.exe"
  (New-Object System.Net.WebClient).DownloadFile("https://win.rustup.rs/", $rustupInit)
  Execute-Command $rustupInit -y
  Add-To-Path "$env:USERPROFILE\.cargo\bin"
}

function Install-Llvm {
  Install-Package llvm `
    -Command clang-cl `
    -Version "18.1.8"
  Add-To-Path "C:\Program Files\LLVM\bin"
}

function Optimize-System {
  Disable-Windows-Defender
  Disable-Windows-Threat-Protection
  Disable-Windows-Services
  Disable-Power-Management
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
  Write-Output "Uninstalling Windows Defender..."
  Uninstall-WindowsFeature -Name Windows-Defender
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
    Stop-Service $service -Force
    Set-Service $service -StartupType Disabled
  }
}

function Disable-Power-Management {
  Write-Output "Disabling power management features..."
  powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c # High performance
  powercfg /change monitor-timeout-ac 0
  powercfg /change monitor-timeout-dc 0
  powercfg /change standby-timeout-ac 0
  powercfg /change standby-timeout-dc 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /change hibernate-timeout-dc 0
}

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
if ($Optimize) {
  Optimize-System
}

Install-Common-Software
Install-Build-Essentials

