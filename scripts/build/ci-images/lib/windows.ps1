# The helpers every tool script may use. A failed command ends the bake. The
# script runs under Windows PowerShell 5.1: PowerShell 7 is one of the things
# it installs.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Fail([string]$Message) {
  throw "bootstrap: $Message"
}

# Download <url> <file>
# A fresh Windows image only has Windows PowerShell 5.1, where Invoke-WebRequest
# cannot retry and is slow on large files.
function Download([string]$Url, [string]$File) {
  $client = New-Object System.Net.WebClient
  foreach ($attempt in 1..3) {
    try {
      $client.DownloadFile($Url, $File)
      return
    } catch {
      if ($attempt -eq 3) { Fail "could not download $($Url): $_" }
      Start-Sleep -Seconds 5
    }
  }
}

# Remove-Temp <path>...
# Deletes downloads and scratch directories. One that cannot be deleted yet
# (Defender is still scanning an installer that just ran) is not a failure.
function Remove-Temp {
  Remove-Item $args -Recurse -Force -ErrorAction SilentlyContinue
}

# Runs a native command and fails when it does; PowerShell does not by itself.
function Run {
  $command, $arguments = $args
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "$command exited with code $LASTEXITCODE"
  }
}

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

function Add-To-Path([string]$Directory) {
  $path = [Environment]::GetEnvironmentVariable("Path", "Machine").TrimEnd(";")
  [Environment]::SetEnvironmentVariable("Path", "$path;$Directory", "Machine")
  Refresh-Path
}

function Set-Env([string]$Name, [string]$Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, "Machine")
  [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

# Scoop reports a failed install on stdout and exits 0; the package's
# directory is what says whether it worked. <package> may be name@version.
function Install-Scoop-Package([string]$Package) {
  # Scoop is PowerShell running in this session, and its manifests' cleanup
  # steps write errors that are not failures (7zip on ARM64 cannot delete its
  # own 7zr.exe; llvm on ARM64 has no Uninstall.exe to remove). Under "Stop"
  # each of those would end the bake. Whether the install worked is what the
  # check below decides.
  $ErrorActionPreference = "SilentlyContinue"
  scoop install $Package *>&1 | ForEach-Object { "$_" } | Write-Host
  $ErrorActionPreference = "Stop"
  Refresh-Path
  $name = $Package.Split("@")[0]
  if (-not (Test-Path "C:\Scoop\apps\$name\current")) {
    Fail "scoop install $Package failed"
  }
}
