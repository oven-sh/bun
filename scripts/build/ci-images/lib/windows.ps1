# The helpers every tool script may use. A failed command ends the bake.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Fail([string]$Message) {
  throw "bootstrap: $Message"
}

# Download <url> <file>
function Download([string]$Url, [string]$File) {
  Invoke-WebRequest -Uri $Url -OutFile $File -UseBasicParsing -MaximumRetryCount 3 -RetryIntervalSec 5
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
  scoop install $Package
  Refresh-Path
  $name = $Package.Split("@")[0]
  if (-not (Test-Path "C:\Scoop\apps\$name\current")) {
    Fail "scoop install $Package failed"
  }
}
