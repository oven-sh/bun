#!/usr/bin/env pwsh

# Windows Code Signing Script for Buildkite
# This PowerShell script handles Windows binary signing using DigiCert KeyLocker
# It must run on Windows agents only

param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️ $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Assert-WindowsEnvironment {
    Write-Header "Checking Environment"
    
    if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
        throw "This script must run on Windows. Current OS: $($PSVersionTable.OS)"
    }
    
    if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
        throw "PowerShell Core detected but not on Windows"
    }
    
    Write-Success "Windows environment confirmed"
    Write-Host "PowerShell Version: $($PSVersionTable.PSVersion)"
    Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
}

function Assert-BuildkiteEnvironment {
    Write-Header "Checking Buildkite Environment"
    
    if (-not $env:BUILDKITE) {
        throw "Not running in Buildkite environment"
    }
    
    if (-not (Get-Command "buildkite-agent" -ErrorAction SilentlyContinue)) {
        throw "buildkite-agent command not found"
    }
    
    Write-Success "Buildkite environment confirmed"
    Write-Host "Build: $env:BUILDKITE_BUILD_NUMBER"
    Write-Host "Pipeline: $env:BUILDKITE_PIPELINE_SLUG"
}

function Get-BuildkiteSecret {
    param([string]$SecretName)
    
    try {
        $secret = & buildkite-agent secret get $SecretName
        if ([string]::IsNullOrEmpty($secret)) {
            throw "Secret $SecretName is empty"
        }
        return $secret
    } catch {
        throw "Failed to get Buildkite secret $SecretName: $_"
    }
}

function Assert-DigiCertSecrets {
    Write-Header "Checking DigiCert KeyLocker Secrets"
    
    $requiredSecrets = @(
        "SM_API_KEY",
        "SM_HOST", 
        "SM_CLIENT_CERT_FILE_B64",
        "SM_CLIENT_CERT_PASSWORD",
        "SM_CODE_SIGNING_CERT_SHA1_HASH"
    )
    
    $secrets = @{}
    
    foreach ($secretName in $requiredSecrets) {
        try {
            $secrets[$secretName] = Get-BuildkiteSecret $secretName
            Write-Success "$secretName configured"
        } catch {
            throw "Missing required secret: $secretName"
        }
    }
    
    # Also get GitHub token
    try {
        $secrets["GITHUB_TOKEN"] = Get-BuildkiteSecret "GITHUB_TOKEN"
        Write-Success "GITHUB_TOKEN configured"
    } catch {
        throw "Missing required secret: GITHUB_TOKEN"
    }
    
    return $secrets
}

function Setup-DigiCertKeyLocker {
    param([hashtable]$Secrets)
    
    Write-Header "Setting up DigiCert KeyLocker"
    
    # Create client certificate file from base64
    $certPath = Join-Path $env:TEMP "client_certificate.p12"
    try {
        $certBytes = [System.Convert]::FromBase64String($Secrets["SM_CLIENT_CERT_FILE_B64"])
        [System.IO.File]::WriteAllBytes($certPath, $certBytes)
        Write-Success "Client certificate saved to $certPath"
    } catch {
        throw "Failed to decode client certificate: $_"
    }
    
    # Set environment variables for DigiCert KeyLocker
    $env:SM_HOST = $Secrets["SM_HOST"]
    $env:SM_API_KEY = $Secrets["SM_API_KEY"]
    $env:SM_CLIENT_CERT_FILE = $certPath
    $env:SM_CLIENT_CERT_PASSWORD = $Secrets["SM_CLIENT_CERT_PASSWORD"]
    $env:GH_TOKEN = $Secrets["GITHUB_TOKEN"]
    
    Write-Success "DigiCert KeyLocker environment configured"
    Write-Host "  Host: $env:SM_HOST"
    Write-Host "  Certificate: $certPath"
    Write-Host "  Fingerprint: $($Secrets['SM_CODE_SIGNING_CERT_SHA1_HASH'])"
    
    return $certPath
}

function Install-DigiCertTools {
    Write-Header "Installing DigiCert KeyLocker Tools"
    
    # Check if smctl is already available
    if (Get-Command "smctl" -ErrorAction SilentlyContinue) {
        Write-Success "DigiCert SMCTL already installed"
        return
    }
    
    # Download and install DigiCert SMCTL
    $smctlUrl = "https://one.digicert.com/signingmanager/api-ui/v1/releases/smtools-windows-x64.msi"
    $smctlInstaller = Join-Path $env:TEMP "smtools-windows-x64.msi"
    
    Write-Host "Downloading DigiCert SMCTL from $smctlUrl"
    try {
        Invoke-WebRequest -Uri $smctlUrl -OutFile $smctlInstaller
        Write-Success "Downloaded SMCTL installer"
    } catch {
        throw "Failed to download SMCTL installer: $_"
    }
    
    Write-Host "Installing DigiCert SMCTL..."
    try {
        $installProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", $smctlInstaller, "/quiet", "/norestart" -Wait -PassThru
        if ($installProcess.ExitCode -ne 0) {
            throw "Installation failed with exit code $($installProcess.ExitCode)"
        }
        Write-Success "SMCTL installed successfully"
    } catch {
        throw "Failed to install SMCTL: $_"
    }
    
    # Add to PATH
    $smctlPath = "${env:ProgramFiles}\DigiCert\DigiCert One Signing Manager Tools"
    if (Test-Path $smctlPath) {
        $env:PATH = "$smctlPath;$env:PATH"
        Write-Success "Added SMCTL to PATH"
    }
    
    # Verify installation
    if (-not (Get-Command "smctl" -ErrorAction SilentlyContinue)) {
        throw "SMCTL installation verification failed"
    }
    
    Write-Success "DigiCert SMCTL installation verified"
}

function Test-KeyLockerConnection {
    param([string]$CertFingerprint)
    
    Write-Header "Testing DigiCert KeyLocker Connection"
    
    # Test health check
    Write-Host "Running KeyLocker health check..."
    try {
        $healthResult = & smctl healthcheck
        Write-Success "KeyLocker health check passed"
    } catch {
        throw "KeyLocker health check failed: $_"
    }
    
    # List available certificates
    Write-Host "Listing available certificates..."
    try {
        $keystoreList = & smctl keypair ls
        Write-Host $keystoreList
    } catch {
        throw "Failed to list certificates: $_"
    }
    
    # Verify specific certificate exists
    Write-Host "Verifying certificate fingerprint: $CertFingerprint"
    if ($keystoreList -match $CertFingerprint) {
        Write-Success "Certificate fingerprint found in KeyLocker"
    } else {
        throw "Certificate with fingerprint $CertFingerprint not found in KeyLocker"
    }
}

function Get-ReleaseTag {
    param([string]$Version)
    
    if ($Version -eq "canary") {
        return "canary"
    } else {
        return "bun-v$Version"
    }
}

function Download-BuildkiteArtifact {
    param([string]$ArtifactName, [string]$DestinationDir)
    
    Write-Host "Downloading Buildkite artifact: $ArtifactName"
    try {
        & buildkite-agent artifact download $ArtifactName $DestinationDir
        
        $artifactPath = Join-Path $DestinationDir $ArtifactName
        if (-not (Test-Path $artifactPath)) {
            throw "Artifact file not found after download: $artifactPath"
        }
        
        $size = (Get-Item $artifactPath).Length
        $sizeMB = [math]::Round($size / 1MB, 2)
        Write-Success "Downloaded $ArtifactName ($sizeMB MB)"
        
        return $artifactPath
    } catch {
        throw "Failed to download artifact $ArtifactName: $_"
    }
}

function Sign-WindowsBinaries {
    param([string]$Version, [string]$CertFingerprint)
    
    Write-Header "Signing Windows Binaries for $Version"
    
    $tag = Get-ReleaseTag $Version
    
    # Windows artifacts to sign
    $windowsArtifacts = @(
        "bun-windows-x64.zip",
        "bun-windows-x64-profile.zip", 
        "bun-windows-x64-baseline.zip",
        "bun-windows-x64-baseline-profile.zip"
    )
    
    # Create working directories
    $workDir = Join-Path $env:TEMP "windows-signing"
    $downloadDir = Join-Path $workDir "downloads"
    $extractDir = Join-Path $workDir "extracted"
    $signedDir = Join-Path $workDir "signed"
    
    foreach ($dir in @($downloadDir, $extractDir, $signedDir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    
    $signedCount = 0
    
    foreach ($artifact in $windowsArtifacts) {
        Write-Host ""
        Write-Host "=== Processing $artifact ===" -ForegroundColor Yellow
        
        try {
            # Download artifact from Buildkite
            $artifactPath = Download-BuildkiteArtifact $artifact $downloadDir
            
            # Extract the zip file
            $extractPath = Join-Path $extractDir ($artifact -replace '\.zip$', '')
            Write-Host "Extracting to: $extractPath"
            Expand-Archive -Path $artifactPath -DestinationPath $extractPath -Force
            
            # Find all .exe files
            $exeFiles = Get-ChildItem -Path $extractPath -Recurse -Filter "*.exe"
            
            if ($exeFiles.Count -eq 0) {
                Write-Warning "No .exe files found in $artifact"
                continue
            }
            
            Write-Host "Found $($exeFiles.Count) executable files:"
            foreach ($exe in $exeFiles) {
                Write-Host "  - $($exe.FullName)"
            }
            
            # Sign each executable
            foreach ($exe in $exeFiles) {
                $exeName = $exe.Name
                Write-Host "Signing $exeName with DigiCert KeyLocker..."
                
                try {
                    & smctl sign --fingerprint $CertFingerprint --input $exe.FullName
                    if ($LASTEXITCODE -ne 0) {
                        throw "smctl exited with code $LASTEXITCODE"
                    }
                    Write-Success "Signed $exeName"
                } catch {
                    throw "Failed to sign $exeName`: $_"
                }
                
                # Verify signature
                Write-Host "Verifying signature for $exeName..."
                try {
                    $verifyResult = & signtool verify /pa /v $exe.FullName 2>&1
                    if ($LASTEXITCODE -ne 0) {
                        Write-Warning "Signature verification warning for $exeName"
                        Write-Host $verifyResult
                    } else {
                        Write-Success "Signature verified for $exeName"
                    }
                } catch {
                    Write-Warning "Could not verify signature for $exeName`: $_"
                }
            }
            
            # Repackage signed binaries
            $signedArtifactPath = Join-Path $signedDir $artifact
            Write-Host "Repackaging to: $signedArtifactPath"
            Compress-Archive -Path "$extractPath\*" -DestinationPath $signedArtifactPath -Force
            
            Write-Success "Created signed package: $artifact"
            $signedCount++
            
        } catch {
            Write-Error "Failed to process $artifact`: $_"
            throw
        }
    }
    
    Write-Header "Signing Summary"
    Write-Success "Successfully signed $signedCount Windows packages"
    
    # Upload signed binaries to GitHub release
    Write-Header "Uploading Signed Binaries"
    
    $signedFiles = Get-ChildItem -Path $signedDir -Filter "*.zip"
    foreach ($signedFile in $signedFiles) {
        $filename = $signedFile.Name
        Write-Host "Uploading signed binary: $filename"
        
        try {
            & gh release upload $tag $signedFile.FullName --clobber --repo $env:BUILDKITE_REPO
            if ($LASTEXITCODE -ne 0) {
                throw "gh release upload exited with code $LASTEXITCODE"
            }
            
            # Verify upload with retry logic
            $retryCount = 0
            $maxRetries = 5
            do {
                Start-Sleep -Seconds 2
                $releaseInfo = & gh release view $tag --repo $env:BUILDKITE_REPO --json assets 2>$null
                if ($releaseInfo -and ($releaseInfo | ConvertFrom-Json).assets | Where-Object { $_.name -eq $filename }) {
                    break
                }
                $retryCount++
                if ($retryCount -lt $maxRetries) {
                    Write-Host "Upload verification failed, retrying..."
                    & gh release upload $tag $signedFile.FullName --clobber --repo $env:BUILDKITE_REPO
                }
            } while ($retryCount -lt $maxRetries)
            
            Write-Success "Uploaded $filename"
        } catch {
            throw "Failed to upload $filename`: $_"
        }
    }
    
    return $workDir
}

function Cleanup {
    param([string]$WorkDir, [string]$CertPath)
    
    Write-Header "Cleanup"
    
    # Remove certificate file
    if (Test-Path $CertPath) {
        Remove-Item $CertPath -Force
        Write-Success "Removed client certificate"
    }
    
    # Remove working directory
    if (Test-Path $WorkDir) {
        Remove-Item $WorkDir -Recurse -Force
        Write-Success "Removed working directory"
    }
    
    Write-Success "Cleanup complete"
}

# Main execution
function Main {
    param([string]$Version)
    
    try {
        Write-Header "Windows Code Signing for Bun $Version"
        
        # Validate environment
        Assert-WindowsEnvironment
        Assert-BuildkiteEnvironment
        
        # Get secrets
        $secrets = Assert-DigiCertSecrets
        
        # Setup DigiCert KeyLocker
        $certPath = Setup-DigiCertKeyLocker $secrets
        Install-DigiCertTools
        Test-KeyLockerConnection $secrets["SM_CODE_SIGNING_CERT_SHA1_HASH"]
        
        # Sign Windows binaries
        $workDir = Sign-WindowsBinaries $Version $secrets["SM_CODE_SIGNING_CERT_SHA1_HASH"]
        
        Write-Header "Windows Code Signing Complete"
        Write-Success "All Windows binaries have been signed with DigiCert KeyLocker"
        Write-Success "Signed binaries uploaded to GitHub release: $(Get-ReleaseTag $Version)"
        
    } catch {
        Write-Error "Windows code signing failed: $_"
        exit 1
    } finally {
        # Always cleanup
        if ($certPath) { 
            Cleanup $workDir $certPath 
        }
    }
}

# Run main function
Main $Version