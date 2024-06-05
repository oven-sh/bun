# To convert to a AWS user data script, use the following format:
# <powershell>
#  ...
# </powershell>
# <powershellArguments>-ExecutionPolicy Unrestricted -NoProfile -NonInteractive</powershellArguments>

function Refresh-Environment {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Process")
  if ($env:ChocolateyInstall) {
    Import-Module $env:ChocolateyInstall\helpers\chocolateyProfile.psm1
  }
}

# Escelate to administrator
# if (-Not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] 'Administrator')) {
#   if ([int](Get-CimInstance -Class Win32_OperatingSystem | Select-Object -ExpandProperty BuildNumber) -ge 6000) {
#     $CommandLine = "-File `"" + $MyInvocation.MyCommand.Path + "`" " + $MyInvocation.UnboundArguments
#     Start-Process -FilePath PowerShell.exe -Verb Runas -ArgumentList $CommandLine
#     Exit
#   }
# }

# Set the execution policy to unrestricted
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072

# Install OpenSSH server
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Start the OpenSSH server
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
if (!(Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue | Select-Object Name, Enabled)) {
  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
}

# Install Chocolatey
if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
  irm chocolatey.org/install.ps1 | iex
  Refresh-Environment
}

# Install dependencies
choco install -y git powershell-core cygwin visualstudio2022community make ninja pnpm
choco install -y --installargs 'ADD_CMAKE_TO_PATH=User' cmake

# Install Visual Studio
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe" install --productId Microsoft.VisualStudio.Product.Community --channelId VisualStudio.17.Release --add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Component.Windows10SDK.20348 --includeRecommended --includeOptional --installWhileDownloading

# Install scoop
if (!(Get-Command scoop -ErrorAction SilentlyContinue)) {
  iex "& {$(irm get.scoop.sh)} -RunAsAdmin"
  Refresh-Environment
}

# Install dependencies
scoop install nodejs-lts go rust nasm ruby perl python nssm

# Install LLVM
# Apparently, there is weirdness if installed with the other dependencies?
scoop install llvm@16.0.6

# Install Bun
irm bun.sh/install.ps1 | iex

# Refresh the environment
Refresh-Environment

# Install BuildKite
$buildkitePath = "C:\buildkite-agent\buildkite-agent.cfg"
if (!(Test-Path $buildkitePath)) {
  irm raw.githubusercontent.com/buildkite/agent/main/install.ps1 | iex
  Refresh-Environment
}

# Configure BuildKite
$buildkiteConfig = Get-Content $buildkitePath

# Check the architecture
$arch = $Env:PROCESSOR_ARCHITECTURE
if ($arch -eq "AMD64") {
  $arch = "x64"
} elseif ($arch -eq "Arm64") {
  $arch = "aarch64"
} else {
  Write-Host "Unknown architecture: $arch"
  Exit
}

$buildkiteTags = "os=windows,arch=$arch"
if ($buildkiteConfig -match "tags=") {
  $buildkiteConfig = $buildkiteConfig -replace "^#? ?tags=.*", "tags=`"$buildkiteTags`""
} else {
  $buildkiteConfig = $buildkiteConfig + "`ntags=`"$buildkiteTags`"`n"
}

$buildkiteShell = (Get-Command pwsh).Source
if ($buildkiteConfig -match "shell=") {
  $buildkiteConfig = $buildkiteConfig -replace "^#? ?shell=.*", "shell=`"$buildkiteShell`""
} else {
  $buildkiteConfig = $buildkiteConfig + "`nshell=`"$buildkiteShell`"`n"
}

Set-Content $buildkitePath $buildkiteConfig

# Configure Git
git config --global core.autocrlf false
git config --global core.eol lf

# Start the BuildKite agent
nssm install buildkite-agent "C:\buildkite-agent\bin\buildkite-agent.exe" "start"
nssm set buildkite-agent AppStdout "C:\buildkite-agent\buildkite-agent.log"
nssm set buildkite-agent AppStderr "C:\buildkite-agent\buildkite-agent.log"

# Read password from the environment
# $password = $env:BUILDKITE_AGENT_PASSWORD
# if (!$password) {
#   $password = Read-Host -AsSecureString -Prompt "Enter the '$env:USERNAME' password for the BuildKite agent"
# }
# if (!$password) {
#   Write-Host "No password provided."
#   Exit
# }
# nssm set buildkite-agent ObjectName "$env:COMPUTERNAME\$env:USERNAME" "$password"

nssm start buildkite-agent
nssm restart buildkite-agent