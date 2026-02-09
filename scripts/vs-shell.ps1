# Ensures that commands run in a Visual Studio environment.
# This is required to run commands like cmake and ninja on Windows.

$ErrorActionPreference = "Stop"

# Detect system architecture
$script:IsARM64 = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64

# Allow overriding the target arch (useful for cross-compiling on x64 -> ARM64)
$script:VsArch = $null
if ($env:BUN_VS_ARCH) {
  switch ($env:BUN_VS_ARCH.ToLowerInvariant()) {
    "arm64" { $script:VsArch = "arm64" }
    "aarch64" { $script:VsArch = "arm64" }
    "amd64" { $script:VsArch = "amd64" }
    "x64" { $script:VsArch = "amd64" }
    default { throw "Invalid BUN_VS_ARCH: $env:BUN_VS_ARCH (expected arm64|amd64)" }
  }
}

if (-not $script:VsArch) {
  $script:VsArch = if ($script:IsARM64) { "arm64" } else { "amd64" }
}

if($env:VSINSTALLDIR -eq $null) {
  Write-Host "Loading Visual Studio environment, this may take a second..."

  $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  if (!(Test-Path $vswhere)) {
    throw "Command not found: vswhere (did you install Visual Studio?)"
  }

  $vsDir = (& $vswhere -prerelease -latest -property installationPath)
  if ($vsDir -eq $null) {
    # Check common VS installation paths
    $searchPaths = @(
      "C:\Program Files\Microsoft Visual Studio\2022",
      "C:\Program Files (x86)\Microsoft Visual Studio\2022"
    )
    foreach ($searchPath in $searchPaths) {
      if (Test-Path $searchPath) {
        $vsDir = (Get-ChildItem -Path $searchPath -Directory | Select-Object -First 1).FullName
        if ($vsDir -ne $null) { break }
      }
    }
    if ($vsDir -eq $null) {
      throw "Visual Studio directory not found."
    }
  }

  Push-Location $vsDir
  try {
    $vsShell = (Join-Path -Path $vsDir -ChildPath "Common7\Tools\Launch-VsDevShell.ps1")
    # Visual Studio's Launch-VsDevShell.ps1 only supports x86/amd64 for HostArch
    # For ARM64 builds, use amd64 as HostArch since it can cross-compile to ARM64
    $hostArch = if ($script:VsArch -eq "arm64") { "amd64" } else { $script:VsArch }
    . $vsShell -Arch $script:VsArch -HostArch $hostArch
  } finally {
    Pop-Location
  }
}

if($env:VSCMD_ARG_TGT_ARCH -eq "x86") {
  throw "Visual Studio environment is targeting 32 bit x86, but only 64-bit architectures (x64/arm64) are supported."
}

if ($args.Count -gt 0) {
  $command = $args[0]
  $commandArgs = @()
  if ($args.Count -gt 1) {
    $commandArgs = @($args[1..($args.Count - 1)] | % {$_})
  }

  # Don't print the full command as it may contain sensitive information like certificates
  # Just show the command name and basic info
  $displayArgs = @()
  foreach ($arg in $commandArgs) {
    if ($arg -match "^-") {
      # Include flags
      $displayArgs += $arg
    } elseif ($arg -match "\.(mjs|js|ts|cmake|zig|cpp|c|h|exe)$") {
      # Include file names
      $displayArgs += $arg
    } elseif ($arg.Length -gt 100) {
      # Truncate long arguments (likely certificates or encoded data)
      $displayArgs += "[REDACTED]"
    } else {
      $displayArgs += $arg
    }
  }

  Write-Host "$ $command $displayArgs"
  & $command $commandArgs
  exit $LASTEXITCODE
}
