# Builds MSI installers for every Windows target from the (optionally
# signed) bun-windows-*.zip artifacts, signs the resulting .msi files when
# signing secrets are available, and re-uploads them as Buildkite artifacts.
#
# Runs as its own pipeline step on a Windows x64 agent after either the
# windows-sign step (release builds) or the raw build-bun steps (canary /
# PRs). Packaging is separate from signing so canary builds still get an
# unsigned MSI without burning DigiCert signatures.

param(
    # Comma-separated list of bun-windows-*.zip artifact names.
    [Parameter(Mandatory = $true)]
    [string]$Artifacts,

    # Comma-separated, aligned with $Artifacts, naming the Buildkite step
    # each zip should be downloaded from (windows-sign or *-build-bun).
    [Parameter(Mandatory = $true)]
    [string]$BuildSteps,

    # Comma-separated output .msi names, aligned with $Artifacts.
    [Parameter(Mandatory = $true)]
    [string]$Outputs,

    # Comma-separated WiX arch for each artifact ("x64" or "arm64").
    [Parameter(Mandatory = $true)]
    [string]$Arches,

    # Dotted version for Package/@Version. Passed from ci.mjs so the MSI
    # version matches the rest of the release artifacts exactly.
    [Parameter(Mandatory = $true)]
    [string]$Version,

    # "true" to code-sign the MSIs via DigiCert smctl. Only set on non-canary
    # main builds (same gate as the windows-sign step).
    [string]$Sign = "false"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ArtifactList  = $Artifacts  -split ","
$BuildStepList = $BuildSteps -split ","
$OutputList    = $Outputs    -split ","
$ArchList      = $Arches     -split ","

if ($ArtifactList.Count -ne $BuildStepList.Count -or
    $ArtifactList.Count -ne $OutputList.Count -or
    $ArtifactList.Count -ne $ArchList.Count) {
  throw "Artifact/BuildStep/Output/Arch list lengths must match"
}

$RepoRoot  = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$BuildMsi  = Join-Path $RepoRoot "packages\bun-msi\build-msi.ps1"

# smctl shells out to signtool.exe which only lands on PATH once the VS dev
# environment is loaded. Reuse the helper the sign step already relies on.
. (Join-Path $RepoRoot "scripts\vs-shell.ps1")

function Log-Info    { param($m) Write-Host "[INFO] $m"    -ForegroundColor Cyan }
function Log-Success { param($m) Write-Host "[SUCCESS] $m" -ForegroundColor Green }
function Log-Error   { param($m) Write-Host "[ERROR] $m"   -ForegroundColor Red }

function Get-BuildkiteSecret {
  param([string]$Name)
  $value = & buildkite-agent secret get $Name 2>&1
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($value)) {
    throw "Failed to fetch Buildkite secret: $Name"
  }
  return $value
}

function Download-Artifact {
  param([string]$Name, [string]$StepKey)
  Log-Info "Downloading $Name from step $StepKey"
  & buildkite-agent artifact download $Name . --step $StepKey
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Name)) {
    throw "Failed to download artifact: $Name"
  }
  Log-Success "Downloaded $Name ($((Get-Item $Name).Length) bytes)"
}

function Install-KeyLocker {
  # Duplicated from sign-windows-artifacts.ps1 rather than dot-sourced so the
  # MSI step can run on canary builds where the sign step was skipped (and
  # where we therefore can't assume smctl was already laid down).
  $installDir = "C:\BuildTools\DigiCert"
  $smctlPath = Join-Path $installDir "smctl.exe"
  if (Test-Path $smctlPath) {
    $env:PATH = "$installDir;$env:PATH"
    return $smctlPath
  }
  if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Path $installDir -Force | Out-Null }

  $msiUrl  = "https://bun-ci-assets.bun.sh/Keylockertools-windows-x64.msi"
  $msiPath = Join-Path $env:TEMP "Keylockertools-windows-x64.msi"
  Log-Info "Downloading KeyLocker MSI from $msiUrl"
  if (Test-Path $msiPath) { Remove-Item $msiPath -Force }
  (New-Object System.Net.WebClient).DownloadFile($msiUrl, $msiPath)
  if (-not (Test-Path $msiPath)) { throw "KeyLocker MSI download failed" }

  $proc = Start-Process -FilePath "msiexec.exe" -Wait -PassThru -NoNewWindow -ArgumentList @(
    "/i", "`"$msiPath`"", "/quiet", "/norestart",
    "TARGETDIR=`"$installDir`"", "INSTALLDIR=`"$installDir`"",
    "ACCEPT_EULA=1", "ADDLOCAL=ALL"
  )
  if ($proc.ExitCode -ne 0) { throw "KeyLocker MSI install failed ($($proc.ExitCode))" }

  if (-not (Test-Path $smctlPath)) {
    $found = Get-ChildItem -Path $installDir -Filter "smctl.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $smctlPath = $found.FullName; $installDir = $found.DirectoryName }
    else { throw "smctl.exe not found after install" }
  }
  $env:PATH = "$installDir;$env:PATH"
  return $smctlPath
}

function Initialize-Signing {
  Log-Info "Fetching signing secrets from Buildkite..."
  $env:SM_API_KEY              = Get-BuildkiteSecret "SM_API_KEY"
  $env:SM_CLIENT_CERT_PASSWORD = Get-BuildkiteSecret "SM_CLIENT_CERT_PASSWORD"
  $env:SM_CLIENT_CERT_FILE     = Get-BuildkiteSecret "SM_CLIENT_CERT_FILE"
  $env:SM_KEYPAIR_ALIAS        = Get-BuildkiteSecret "SM_KEYPAIR_ALIAS"
  $env:SM_HOST                 = Get-BuildkiteSecret "SM_HOST"

  try {
    $tempCertPath = Join-Path $env:TEMP "digicert_cert_$(Get-Random).p12"
    [System.IO.File]::WriteAllBytes($tempCertPath, [System.Convert]::FromBase64String($env:SM_CLIENT_CERT_FILE))
    $env:SM_CLIENT_CERT_FILE = $tempCertPath
    $script:TempCertPath = $tempCertPath
  } catch {
    if (-not (Test-Path $env:SM_CLIENT_CERT_FILE)) {
      throw "SM_CLIENT_CERT_FILE is neither valid base64 nor an existing file"
    }
  }

  $smctl = Install-KeyLocker
  & $smctl credentials save $env:SM_API_KEY $env:SM_CLIENT_CERT_PASSWORD 2>&1 | Out-Null
  & $smctl windows certsync 2>&1 | Out-Null
  Log-Success "Signing initialised"
  return $smctl
}

function Sign-Msi {
  param([string]$Path, [string]$Smctl)
  Log-Info "Signing $(Split-Path $Path -Leaf)"
  $out = & $Smctl sign --keypair-alias $env:SM_KEYPAIR_ALIAS --input $Path --verbose 2>&1 | Out-String
  Log-Info "smctl output: $out"
  # smctl exits 0 even on failure — must also check output text.
  if ($LASTEXITCODE -ne 0 -or $out -like "*FAILED*" -or $out -like "*error*") {
    throw "Signing failed for $Path (exit $LASTEXITCODE): $out"
  }
  $sig = Get-AuthenticodeSignature $Path
  if ($sig.Status -ne "Valid") {
    throw "$Path signature verification failed: $($sig.Status) - $($sig.StatusMessage)"
  }
  Log-Success "$(Split-Path $Path -Leaf) signed by $($sig.SignerCertificate.Subject)"
}

try {
  Write-Host "================================================" -ForegroundColor Cyan
  Write-Host "  Windows MSI packaging" -ForegroundColor Cyan
  Write-Host "================================================" -ForegroundColor Cyan

  $ShouldSign = ($Sign -eq "true" -or $Sign -eq "1")
  $Smctl = $null
  if ($ShouldSign) { $Smctl = Initialize-Signing }

  for ($i = 0; $i -lt $ArtifactList.Count; $i++) {
    $zip    = $ArtifactList[$i]
    $step   = $BuildStepList[$i]
    $out    = $OutputList[$i]
    $arch   = $ArchList[$i]

    Write-Host "------------------------------------------------" -ForegroundColor Cyan
    Write-Host "  $zip -> $out ($arch)" -ForegroundColor Cyan
    Write-Host "------------------------------------------------" -ForegroundColor Cyan

    Download-Artifact -Name $zip -StepKey $step

    $extractDir = [System.IO.Path]::GetFileNameWithoutExtension($zip)
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath . -Force
    if (-not (Test-Path $extractDir)) { throw "Expected $extractDir after extraction" }

    $exe = Get-ChildItem -Path $extractDir -Filter "bun.exe" | Select-Object -First 1
    if (-not $exe) { throw "bun.exe not found inside $extractDir" }

    & pwsh -NoProfile -ExecutionPolicy Bypass -File $BuildMsi `
        -BunExe $exe.FullName -Arch $arch -Version $Version -Output $out
    if ($LASTEXITCODE -ne 0) { throw "build-msi.ps1 failed for $out ($LASTEXITCODE)" }

    if ($ShouldSign) { Sign-Msi -Path $out -Smctl $Smctl }

    Log-Info "Uploading $out"
    & buildkite-agent artifact upload $out
    if ($LASTEXITCODE -ne 0) { throw "Failed to upload $out" }

    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Log-Success "$out built and uploaded"
  }

  Write-Host "================================================" -ForegroundColor Green
  Write-Host "  All MSI installers built" -ForegroundColor Green
  Write-Host "================================================" -ForegroundColor Green
  exit 0

} catch {
  Log-Error "MSI packaging failed: $_"
  exit 1

} finally {
  if ($script:TempCertPath -and (Test-Path $script:TempCertPath)) {
    Remove-Item $script:TempCertPath -Force -ErrorAction SilentlyContinue
  }
}
