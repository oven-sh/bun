# Batch Windows code signing for all bun-windows-*.zip Buildkite artifacts.
#
# This runs as a dedicated pipeline step on a Windows x64 agent after all
# Windows build-bun steps complete. Signing is done here instead of inline
# during each build because DigiCert smctl is x64-only and silently fails
# under ARM64 emulation.
#
# Each zip is downloaded, its exe signed in place, and the zip is re-packed
# with the same name so downstream steps (release, tests) see signed binaries.

param(
    # Comma-separated list. powershell.exe -File passes everything as
    # literal strings, so [string[]] with "a,b,c" becomes a 1-element array.
    [Parameter(Mandatory=$true)]
    [string]$Artifacts,

    # Comma-separated, same length as Artifacts, mapping each zip to its source step.
    [Parameter(Mandatory=$true)]
    [string]$BuildSteps
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ArtifactList = $Artifacts -split ","
$BuildStepList = $BuildSteps -split ","

# smctl shells out to signtool.exe which is only in PATH when the VS dev
# environment is loaded. Dot-source the existing helper to set it up.
. $PSScriptRoot\..\..\scripts\vs-shell.ps1

function Log-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Log-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Log-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Log-Debug {
    param([string]$Message)
    if ($env:DEBUG -eq "true" -or $env:DEBUG -eq "1") {
        Write-Host "[DEBUG] $Message" -ForegroundColor Gray
    }
}

function Get-BuildkiteSecret {
    param([string]$Name)
    $value = & buildkite-agent secret get $Name 2>&1
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($value)) {
        throw "Failed to fetch Buildkite secret: $Name"
    }
    return $value
}

function Ensure-Secrets {
    Log-Info "Fetching signing secrets from Buildkite..."
    $env:SM_API_KEY = Get-BuildkiteSecret "SM_API_KEY"
    $env:SM_CLIENT_CERT_PASSWORD = Get-BuildkiteSecret "SM_CLIENT_CERT_PASSWORD"
    $env:SM_CLIENT_CERT_FILE = Get-BuildkiteSecret "SM_CLIENT_CERT_FILE"
    $env:SM_KEYPAIR_ALIAS = Get-BuildkiteSecret "SM_KEYPAIR_ALIAS"
    $env:SM_HOST = Get-BuildkiteSecret "SM_HOST"
    Log-Success "All signing secrets fetched"
}

function Setup-Certificate {
    Log-Info "Decoding client certificate..."
    try {
        $tempCertPath = Join-Path $env:TEMP "digicert_cert_$(Get-Random).p12"
        $certBytes = [System.Convert]::FromBase64String($env:SM_CLIENT_CERT_FILE)
        [System.IO.File]::WriteAllBytes($tempCertPath, $certBytes)
        $fileSize = (Get-Item $tempCertPath).Length
        if ($fileSize -lt 100) {
            throw "Decoded certificate too small: $fileSize bytes"
        }
        $env:SM_CLIENT_CERT_FILE = $tempCertPath
        $script:TempCertPath = $tempCertPath
        Log-Success "Certificate decoded ($fileSize bytes)"
    } catch {
        if (Test-Path $env:SM_CLIENT_CERT_FILE) {
            Log-Info "Using certificate file path directly: $env:SM_CLIENT_CERT_FILE"
        } else {
            throw "SM_CLIENT_CERT_FILE is neither valid base64 nor an existing file"
        }
    }
}

function Install-KeyLocker {
    Log-Info "Setting up DigiCert KeyLocker tools..."
    $installDir = "C:\BuildTools\DigiCert"
    $smctlPath = Join-Path $installDir "smctl.exe"

    if (Test-Path $smctlPath) {
        Log-Success "smctl already installed at $smctlPath"
        $env:PATH = "$installDir;$env:PATH"
        return $smctlPath
    }

    if (!(Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }

    # smctl is x64-only; this script must run on an x64 agent
    $msiUrl = "https://bun-ci-assets.bun.sh/Keylockertools-windows-x64.msi"
    $msiPath = Join-Path $env:TEMP "Keylockertools-windows-x64.msi"

    Log-Info "Downloading KeyLocker MSI from $msiUrl"
    if (Test-Path $msiPath) { Remove-Item $msiPath -Force }
    (New-Object System.Net.WebClient).DownloadFile($msiUrl, $msiPath)
    if (!(Test-Path $msiPath)) { throw "MSI download failed" }

    Log-Info "Installing KeyLocker MSI..."
    $proc = Start-Process -FilePath "msiexec.exe" -Wait -PassThru -NoNewWindow -ArgumentList @(
        "/i", "`"$msiPath`"",
        "/quiet", "/norestart",
        "TARGETDIR=`"$installDir`"",
        "INSTALLDIR=`"$installDir`"",
        "ACCEPT_EULA=1",
        "ADDLOCAL=ALL"
    )
    if ($proc.ExitCode -ne 0) {
        throw "MSI install failed with exit code $($proc.ExitCode)"
    }

    if (!(Test-Path $smctlPath)) {
        $found = Get-ChildItem -Path $installDir -Filter "smctl.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $smctlPath = $found.FullName
            $installDir = $found.DirectoryName
        } else {
            throw "smctl.exe not found after install"
        }
    }

    $env:PATH = "$installDir;$env:PATH"
    Log-Success "smctl installed at $smctlPath"
    return $smctlPath
}

function Configure-KeyLocker {
    param([string]$Smctl)
    Log-Info "Configuring KeyLocker..."

    $version = & $Smctl --version 2>&1
    Log-Debug "smctl version: $version"

    $saveOut = & $Smctl credentials save $env:SM_API_KEY $env:SM_CLIENT_CERT_PASSWORD 2>&1 | Out-String
    Log-Debug "credentials save: $saveOut"

    $healthOut = & $Smctl healthcheck 2>&1 | Out-String
    Log-Debug "healthcheck: $healthOut"
    if ($healthOut -notlike "*Healthy*" -and $healthOut -notlike "*SUCCESS*" -and $LASTEXITCODE -ne 0) {
        Log-Error "healthcheck output: $healthOut"
        # Don't throw — healthcheck is sometimes flaky but signing still works
    }

    $syncOut = & $Smctl windows certsync 2>&1 | Out-String
    Log-Debug "certsync: $syncOut"

    Log-Success "KeyLocker configured"
}

function Download-Artifact {
    param([string]$Name, [string]$StepKey)

    Log-Info "Downloading $Name from step $StepKey"
    & buildkite-agent artifact download $Name . --step $StepKey
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $Name)) {
        throw "Failed to download artifact: $Name"
    }
    Log-Success "Downloaded $Name ($((Get-Item $Name).Length) bytes)"
}

function Sign-Exe {
    param([string]$ExePath, [string]$Smctl)

    $fileName = Split-Path $ExePath -Leaf
    Log-Info "Signing $fileName ($((Get-Item $ExePath).Length) bytes)..."

    $existing = Get-AuthenticodeSignature $ExePath
    if ($existing.Status -eq "Valid") {
        Log-Info "$fileName already signed by $($existing.SignerCertificate.Subject), skipping"
        return
    }

    $out = & $Smctl sign --keypair-alias $env:SM_KEYPAIR_ALIAS --input $ExePath --verbose 2>&1 | Out-String
    Log-Info "smctl output: $out"
    # smctl exits 0 even on failure — must also check output text
    if ($LASTEXITCODE -ne 0 -or $out -like "*FAILED*" -or $out -like "*error*") {
        throw "Signing failed for $fileName (exit $LASTEXITCODE): $out"
    }

    $sig = Get-AuthenticodeSignature $ExePath
    if ($sig.Status -ne "Valid") {
        throw "$fileName signature verification failed: $($sig.Status) - $($sig.StatusMessage)"
    }
    Log-Success "$fileName signed by $($sig.SignerCertificate.Subject)"
}

function Sign-Artifact {
    param([string]$ZipName, [string]$Smctl)

    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "  Signing $ZipName" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan

    $extractDir = [System.IO.Path]::GetFileNameWithoutExtension($ZipName)

    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }

    Log-Info "Extracting $ZipName"
    Expand-Archive -Path $ZipName -DestinationPath . -Force
    if (!(Test-Path $extractDir)) {
        throw "Expected directory $extractDir not found after extraction"
    }

    $exes = Get-ChildItem -Path $extractDir -Filter "*.exe"
    if ($exes.Count -eq 0) {
        throw "No .exe files found in $extractDir"
    }

    foreach ($exe in $exes) {
        Sign-Exe -ExePath $exe.FullName -Smctl $Smctl
    }

    Log-Info "Re-packing $ZipName"
    Remove-Item $ZipName -Force
    Compress-Archive -Path $extractDir -DestinationPath $ZipName -CompressionLevel Optimal
    Remove-Item $extractDir -Recurse -Force

    Log-Info "Uploading signed $ZipName"
    & buildkite-agent artifact upload $ZipName
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upload $ZipName"
    }

    Log-Success "$ZipName signed and uploaded"
}

# Main
try {
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "  Windows Artifact Code Signing" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan

    if ($ArtifactList.Count -ne $BuildStepList.Count) {
        throw "Artifact count ($($ArtifactList.Count)) must match BuildStep count ($($BuildStepList.Count))"
    }
    Log-Info "Will sign $($ArtifactList.Count) artifacts: $($ArtifactList -join ', ')"

    Ensure-Secrets
    Setup-Certificate
    $smctl = Install-KeyLocker
    Configure-KeyLocker -Smctl $smctl

    for ($i = 0; $i -lt $ArtifactList.Count; $i++) {
        Download-Artifact -Name $ArtifactList[$i] -StepKey $BuildStepList[$i]
        Sign-Artifact -ZipName $ArtifactList[$i] -Smctl $smctl
    }

    Write-Host "================================================" -ForegroundColor Green
    Write-Host "  All artifacts signed successfully" -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    exit 0

} catch {
    Log-Error "Signing failed: $_"
    exit 1

} finally {
    if ($script:TempCertPath -and (Test-Path $script:TempCertPath)) {
        Remove-Item $script:TempCertPath -Force -ErrorAction SilentlyContinue
    }
}
