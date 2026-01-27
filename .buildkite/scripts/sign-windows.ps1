# Windows Code Signing Script for Bun
# Uses DigiCert KeyLocker for Authenticode signing
# Native PowerShell implementation - no path translation issues

param(
    [Parameter(Mandatory=$true)]
    [string]$BunProfileExe,
    
    [Parameter(Mandatory=$true)]
    [string]$BunExe
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Logging functions
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

# Detect system architecture
$script:IsARM64 = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64
$script:VsArch = if ($script:IsARM64) { "arm64" } else { "amd64" }

# Load Visual Studio environment if not already loaded
function Ensure-VSEnvironment {
    if ($null -eq $env:VSINSTALLDIR) {
        Log-Info "Loading Visual Studio environment for $script:VsArch..."

        $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
        if (!(Test-Path $vswhere)) {
            throw "Command not found: vswhere (did you install Visual Studio?)"
        }

        $vsDir = & $vswhere -prerelease -latest -property installationPath
        if ($null -eq $vsDir) {
            $vsDir = Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022" -Directory -ErrorAction SilentlyContinue
            if ($null -eq $vsDir) {
                throw "Visual Studio directory not found."
            }
            $vsDir = $vsDir.FullName
        }

        Push-Location $vsDir
        try {
            $vsShell = Join-Path -Path $vsDir -ChildPath "Common7\Tools\Launch-VsDevShell.ps1"
            . $vsShell -Arch $script:VsArch -HostArch $script:VsArch
        } finally {
            Pop-Location
        }

        Log-Success "Visual Studio environment loaded"
    }

    if ($env:VSCMD_ARG_TGT_ARCH -eq "x86") {
        throw "Visual Studio environment is targeting 32 bit x86, but only 64-bit architectures (x64/arm64) are supported."
    }
}

# Check for required environment variables
function Check-Environment {
    Log-Info "Checking environment variables..."
    
    $required = @{
        "SM_API_KEY" = $env:SM_API_KEY
        "SM_CLIENT_CERT_PASSWORD" = $env:SM_CLIENT_CERT_PASSWORD
        "SM_KEYPAIR_ALIAS" = $env:SM_KEYPAIR_ALIAS
        "SM_HOST" = $env:SM_HOST
        "SM_CLIENT_CERT_FILE" = $env:SM_CLIENT_CERT_FILE
    }
    
    $missing = @()
    foreach ($key in $required.Keys) {
        if ([string]::IsNullOrEmpty($required[$key])) {
            $missing += $key
        } else {
            Log-Debug "$key is set (length: $($required[$key].Length))"
        }
    }
    
    if ($missing.Count -gt 0) {
        throw "Missing required environment variables: $($missing -join ', ')"
    }
    
    Log-Success "All required environment variables are present"
}

# Setup certificate file
function Setup-Certificate {
    Log-Info "Setting up certificate..."
    
    # Always try to decode as base64 first
    # If it fails, then treat as file path
    try {
        Log-Info "Attempting to decode certificate as base64..."
        Log-Debug "Input string length: $($env:SM_CLIENT_CERT_FILE.Length) characters"
        
        $tempCertPath = Join-Path $env:TEMP "digicert_cert_$(Get-Random).p12"
        
        # Try to decode as base64
        $certBytes = [System.Convert]::FromBase64String($env:SM_CLIENT_CERT_FILE)
        [System.IO.File]::WriteAllBytes($tempCertPath, $certBytes)
        
        # Validate the decoded certificate size
        $fileSize = (Get-Item $tempCertPath).Length
        if ($fileSize -lt 100) {
            throw "Decoded certificate too small: $fileSize bytes (expected >100 bytes)"
        }
        
        # Update environment to point to file
        $env:SM_CLIENT_CERT_FILE = $tempCertPath
        
        Log-Success "Certificate decoded and written to: $tempCertPath"
        Log-Debug "Decoded certificate file size: $fileSize bytes"
        
        # Register cleanup
        $global:TEMP_CERT_PATH = $tempCertPath
        
    } catch {
        # If base64 decode fails, check if it's a file path
        Log-Info "Base64 decode failed, checking if it's a file path..."
        Log-Debug "Decode error: $_"
        
        if (Test-Path $env:SM_CLIENT_CERT_FILE) {
            $fileSize = (Get-Item $env:SM_CLIENT_CERT_FILE).Length
            
            # Validate file size
            if ($fileSize -lt 100) {
                throw "Certificate file too small: $fileSize bytes at $env:SM_CLIENT_CERT_FILE (possibly corrupted)"
            }
            
            Log-Info "Using certificate file: $env:SM_CLIENT_CERT_FILE"
            Log-Debug "Certificate file size: $fileSize bytes"
        } else {
            throw "SM_CLIENT_CERT_FILE is neither valid base64 nor an existing file: $env:SM_CLIENT_CERT_FILE"
        }
    }
}

# Install DigiCert KeyLocker tools
function Install-KeyLocker {
    Log-Info "Setting up DigiCert KeyLocker tools..."
    
    # Define our controlled installation directory
    $installDir = "C:\BuildTools\DigiCert"
    $smctlPath = Join-Path $installDir "smctl.exe"
    
    # Check if already installed in our controlled location
    if (Test-Path $smctlPath) {
        Log-Success "KeyLocker tools already installed at: $smctlPath"
        
        # Add to PATH if not already there
        if ($env:PATH -notlike "*$installDir*") {
            $env:PATH = "$installDir;$env:PATH"
            Log-Info "Added to PATH: $installDir"
        }
        
        return $smctlPath
    }
    
    Log-Info "Installing KeyLocker tools to: $installDir"
    
    # Create the installation directory if it doesn't exist
    if (!(Test-Path $installDir)) {
        Log-Info "Creating installation directory: $installDir"
        try {
            New-Item -ItemType Directory -Path $installDir -Force | Out-Null
            Log-Success "Created directory: $installDir"
        } catch {
            throw "Failed to create directory $installDir : $_"
        }
    }
    
    # Download MSI installer
    # Note: KeyLocker tools currently only available for x64, but works on ARM64 via emulation
    $msiArch = "x64"
    $msiUrl = "https://bun-ci-assets.bun.sh/Keylockertools-windows-${msiArch}.msi"
    $msiPath = Join-Path $env:TEMP "Keylockertools-windows-${msiArch}.msi"
    
    Log-Info "Downloading MSI from: $msiUrl"
    Log-Info "Downloading to: $msiPath"
    
    try {
        # Remove existing MSI if present
        if (Test-Path $msiPath) {
            Remove-Item $msiPath -Force
            Log-Debug "Removed existing MSI file"
        }
        
        # Download with progress tracking
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($msiUrl, $msiPath)
        
        if (!(Test-Path $msiPath)) {
            throw "MSI download failed - file not found"
        }
        
        $fileSize = (Get-Item $msiPath).Length
        Log-Success "MSI downloaded successfully (size: $fileSize bytes)"
        
    } catch {
        throw "Failed to download MSI: $_"
    }
    
    # Install MSI
    Log-Info "Installing MSI..."
    Log-Debug "MSI path: $msiPath"
    Log-Debug "File exists: $(Test-Path $msiPath)"
    Log-Debug "File size: $((Get-Item $msiPath).Length) bytes"
    
    # Check if running as administrator
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Log-Info "Running as administrator: $isAdmin"
    
    # Install MSI silently to our controlled directory
    $arguments = @(
        "/i", "`"$msiPath`"",
        "/quiet",
        "/norestart",
        "TARGETDIR=`"$installDir`"",
        "INSTALLDIR=`"$installDir`"",
        "ACCEPT_EULA=1",
        "ADDLOCAL=ALL"
    )
    
    Log-Debug "Running: msiexec.exe $($arguments -join ' ')"
    Log-Info "Installing to: $installDir"
    
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru -NoNewWindow
    
    if ($process.ExitCode -ne 0) {
        Log-Error "MSI installation failed with exit code: $($process.ExitCode)"
        
        # Try to get error details from event log
        try {
            $events = Get-WinEvent -LogName "Application" -MaxEvents 10 | 
                Where-Object { $_.ProviderName -eq "MsiInstaller" -and $_.TimeCreated -gt (Get-Date).AddMinutes(-1) }
            
            foreach ($event in $events) {
                Log-Debug "MSI Event: $($event.Message)"
            }
        } catch {
            Log-Debug "Could not retrieve MSI installation events"
        }
        
        throw "MSI installation failed with exit code: $($process.ExitCode)"
    }
    
    Log-Success "MSI installation completed"
    
    # Wait for installation to complete
    Start-Sleep -Seconds 2
    
    # Verify smctl.exe exists in our controlled location
    if (Test-Path $smctlPath) {
        Log-Success "KeyLocker tools installed successfully at: $smctlPath"
        
        # Add to PATH
        $env:PATH = "$installDir;$env:PATH"
        Log-Info "Added to PATH: $installDir"
        
        return $smctlPath
    }
    
    # If not in our expected location, check if it installed somewhere in the directory
    $found = Get-ChildItem -Path $installDir -Filter "smctl.exe" -Recurse -ErrorAction SilentlyContinue | 
        Select-Object -First 1
    
    if ($found) {
        Log-Success "Found smctl.exe at: $($found.FullName)"
        $smctlDir = $found.DirectoryName
        $env:PATH = "$smctlDir;$env:PATH"
        return $found.FullName
    }
    
    throw "KeyLocker tools installation succeeded but smctl.exe not found in $installDir"
}

# Configure KeyLocker
function Configure-KeyLocker {
    param([string]$SmctlPath)
    
    Log-Info "Configuring KeyLocker..."
    
    # Verify smctl is accessible
    try {
        $version = & $SmctlPath --version 2>&1
        Log-Debug "smctl version: $version"
    } catch {
        throw "Failed to run smctl: $_"
    }
    
    # Configure KeyLocker credentials and environment
    Log-Info "Configuring KeyLocker credentials..."
    
    try {
        # Save credentials (API key and password)
        Log-Info "Saving credentials to OS store..."
        $saveOutput = & $SmctlPath credentials save $env:SM_API_KEY $env:SM_CLIENT_CERT_PASSWORD 2>&1 | Out-String
        Log-Debug "Credentials save output: $saveOutput"
        
        if ($saveOutput -like "*Credentials saved*") {
            Log-Success "Credentials saved successfully"
        }
        
        # Set environment variables for smctl
        Log-Info "Setting KeyLocker environment variables..."
        $env:SM_HOST = $env:SM_HOST  # Already set, but ensure it's available
        $env:SM_API_KEY = $env:SM_API_KEY  # Already set
        $env:SM_CLIENT_CERT_FILE = $env:SM_CLIENT_CERT_FILE  # Path to decoded cert file
        Log-Debug "SM_HOST: $env:SM_HOST"
        Log-Debug "SM_CLIENT_CERT_FILE: $env:SM_CLIENT_CERT_FILE"
        
        # Run health check
        Log-Info "Running KeyLocker health check..."
        $healthOutput = & $SmctlPath healthcheck 2>&1 | Out-String
        Log-Debug "Health check output: $healthOutput"
        
        if ($healthOutput -like "*Healthy*" -or $healthOutput -like "*SUCCESS*" -or $LASTEXITCODE -eq 0) {
            Log-Success "KeyLocker health check passed"
        } else {
            Log-Error "Health check failed: $healthOutput"
            # Don't throw here, sometimes healthcheck is flaky but signing still works
        }
        
        # Sync certificates to Windows certificate store
        Log-Info "Syncing certificates to Windows store..."
        $syncOutput = & $SmctlPath windows certsync 2>&1 | Out-String
        Log-Debug "Certificate sync output: $syncOutput"
        
        if ($syncOutput -like "*success*" -or $syncOutput -like "*synced*" -or $LASTEXITCODE -eq 0) {
            Log-Success "Certificates synced to Windows store"
        } else {
            Log-Info "Certificate sync output: $syncOutput"
        }
        
    } catch {
        throw "Failed to configure KeyLocker: $_"
    }
}

# Sign an executable
function Sign-Executable {
    param(
        [string]$ExePath,
        [string]$SmctlPath
    )
    
    if (!(Test-Path $ExePath)) {
        throw "Executable not found: $ExePath"
    }
    
    $fileName = Split-Path $ExePath -Leaf
    Log-Info "Signing $fileName..."
    Log-Debug "Full path: $ExePath"
    Log-Debug "File size: $((Get-Item $ExePath).Length) bytes"
    
    # Check if already signed
    $existingSig = Get-AuthenticodeSignature $ExePath
    if ($existingSig.Status -eq "Valid") {
        Log-Info "$fileName is already signed by: $($existingSig.SignerCertificate.Subject)"
        Log-Info "Skipping re-signing"
        return
    }
    
    # Sign the executable using smctl
    try {
        # smctl sign command with keypair-alias
        $signArgs = @(
            "sign",
            "--keypair-alias", $env:SM_KEYPAIR_ALIAS,
            "--input", $ExePath,
            "--verbose"
        )
        
        Log-Debug "Running: $SmctlPath $($signArgs -join ' ')"
        
        $signOutput = & $SmctlPath $signArgs 2>&1 | Out-String
        
        if ($LASTEXITCODE -ne 0) {
            Log-Error "Signing output: $signOutput"
            throw "Signing failed with exit code: $LASTEXITCODE"
        }
        
        Log-Debug "Signing output: $signOutput"
        Log-Success "Signing command completed"
        
    } catch {
        throw "Failed to sign $fileName : $_"
    }
    
    # Verify signature
    $newSig = Get-AuthenticodeSignature $ExePath
    
    if ($newSig.Status -eq "Valid") {
        Log-Success "$fileName signed successfully"
        Log-Info "Signed by: $($newSig.SignerCertificate.Subject)"
        Log-Info "Thumbprint: $($newSig.SignerCertificate.Thumbprint)"
        Log-Info "Valid from: $($newSig.SignerCertificate.NotBefore) to $($newSig.SignerCertificate.NotAfter)"
    } else {
        throw "$fileName signature verification failed: $($newSig.Status) - $($newSig.StatusMessage)"
    }
}

# Cleanup function
function Cleanup {
    if ($global:TEMP_CERT_PATH -and (Test-Path $global:TEMP_CERT_PATH)) {
        try {
            Remove-Item $global:TEMP_CERT_PATH -Force
            Log-Info "Cleaned up temporary certificate"
        } catch {
            Log-Error "Failed to cleanup temporary certificate: $_"
        }
    }
}

# Main execution
try {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Windows Code Signing for Bun" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    # Ensure we're in a VS environment
    Ensure-VSEnvironment
    
    # Check environment variables
    Check-Environment
    
    # Setup certificate
    Setup-Certificate
    
    # Install and configure KeyLocker
    $smctlPath = Install-KeyLocker
    Configure-KeyLocker -SmctlPath $smctlPath
    
    # Sign both executables
    Sign-Executable -ExePath $BunProfileExe -SmctlPath $smctlPath
    Sign-Executable -ExePath $BunExe -SmctlPath $smctlPath
    
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Code signing completed successfully!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    
    exit 0
    
} catch {
    Log-Error "Code signing failed: $_"
    exit 1
    
} finally {
    Cleanup
}