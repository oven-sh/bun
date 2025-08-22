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
    Write-Host "[DEBUG] $Message" -ForegroundColor Gray
}

# Load Visual Studio environment if not already loaded
function Ensure-VSEnvironment {
    if ($null -eq $env:VSINSTALLDIR) {
        Log-Info "Loading Visual Studio environment..."
        
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
            . $vsShell -Arch amd64 -HostArch amd64
        } finally {
            Pop-Location
        }
        
        Log-Success "Visual Studio environment loaded"
    }
    
    if ($env:VSCMD_ARG_TGT_ARCH -eq "x86") {
        throw "Visual Studio environment is targeting 32 bit, but only 64 bit is supported."
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
    
    # Check if certificate is base64 content or file path
    if ($env:SM_CLIENT_CERT_FILE.Length -gt 260) {
        Log-Info "Certificate provided as base64 content, creating temporary file..."
        
        $tempCertPath = Join-Path $env:TEMP "digicert_cert_$(Get-Random).p12"
        
        try {
            $certBytes = [System.Convert]::FromBase64String($env:SM_CLIENT_CERT_FILE)
            [System.IO.File]::WriteAllBytes($tempCertPath, $certBytes)
            
            # Update environment to point to file
            $env:SM_CLIENT_CERT_FILE = $tempCertPath
            
            Log-Success "Certificate written to temporary file: $tempCertPath"
            Log-Debug "Certificate file size: $((Get-Item $tempCertPath).Length) bytes"
            
            # Register cleanup
            $global:TEMP_CERT_PATH = $tempCertPath
            
        } catch {
            throw "Failed to decode certificate: $_"
        }
    } elseif (Test-Path $env:SM_CLIENT_CERT_FILE) {
        Log-Info "Using certificate file: $env:SM_CLIENT_CERT_FILE"
        Log-Debug "Certificate file size: $((Get-Item $env:SM_CLIENT_CERT_FILE).Length) bytes"
    } else {
        throw "Certificate file not found: $env:SM_CLIENT_CERT_FILE"
    }
}

# Install DigiCert KeyLocker tools
function Install-KeyLocker {
    Log-Info "Checking for DigiCert KeyLocker tools..."
    
    # First, check if user has specified the location
    if ($env:SMCTL_PATH) {
        Log-Info "Using user-specified SMCTL_PATH: $env:SMCTL_PATH"
        if (Test-Path $env:SMCTL_PATH) {
            $smctlDir = Split-Path $env:SMCTL_PATH -Parent
            if ($env:PATH -notlike "*$smctlDir*") {
                $env:PATH = "$smctlDir;$env:PATH"
                Log-Info "Added to PATH: $smctlDir"
            }
            return $env:SMCTL_PATH
        } else {
            Log-Error "SMCTL_PATH specified but file not found: $env:SMCTL_PATH"
        }
    }
    
    # Check if smctl.exe is already in PATH
    $smctlInPath = Get-Command smctl.exe -ErrorAction SilentlyContinue
    if ($smctlInPath) {
        Log-Success "smctl.exe found in PATH: $($smctlInPath.Path)"
        return $smctlInPath.Path
    }
    
    # Check for DigiCert directories and log what we find
    Log-Debug "Searching for DigiCert installations..."
    $digiCertSearchPaths = @(
        "C:\Program Files\DigiCert",
        "C:\Program Files (x86)\DigiCert",
        "$env:LOCALAPPDATA\DigiCert",
        "$env:APPDATA\DigiCert",
        "$env:ProgramData\DigiCert"
    )
    
    foreach ($searchPath in $digiCertSearchPaths) {
        if (Test-Path $searchPath) {
            Log-Debug "Found DigiCert directory: $searchPath"
            $subDirs = Get-ChildItem -Path $searchPath -Directory -ErrorAction SilentlyContinue
            foreach ($dir in $subDirs) {
                Log-Debug "  - Subdirectory: $($dir.Name)"
            }
        }
    }
    
    # Check multiple possible installation paths (with case variations)
    $smctlPaths = @(
        "C:\Program Files\DigiCert\DigiCert Keylocker Tools\smctl.exe",
        "C:\Program Files\DigiCert\DigiCert KeyLocker Tools\smctl.exe",  # Different case
        "C:\Program Files (x86)\DigiCert\DigiCert Keylocker Tools\smctl.exe",
        "C:\Program Files (x86)\DigiCert\DigiCert KeyLocker Tools\smctl.exe",
        "C:\Program Files\DigiCert\DigiCert One Signing Manager Tools\smctl.exe",
        "C:\Program Files (x86)\DigiCert\DigiCert One Signing Manager Tools\smctl.exe",
        "$env:LOCALAPPDATA\DigiCert\DigiCert Keylocker Tools\smctl.exe",
        "$env:LOCALAPPDATA\DigiCert\DigiCert KeyLocker Tools\smctl.exe",
        "$env:APPDATA\DigiCert\DigiCert Keylocker Tools\smctl.exe",
        "$env:APPDATA\DigiCert\DigiCert KeyLocker Tools\smctl.exe",
        "$env:ProgramData\DigiCert\DigiCert Keylocker Tools\smctl.exe",
        "$env:ProgramData\DigiCert\DigiCert KeyLocker Tools\smctl.exe"
    )
    
    foreach ($path in $smctlPaths) {
        if (Test-Path $path) {
            Log-Success "KeyLocker tools found at: $path"
            $smctlDir = Split-Path $path -Parent
            
            # Add to PATH if not already there
            if ($env:PATH -notlike "*$smctlDir*") {
                $env:PATH = "$smctlDir;$env:PATH"
                Log-Info "Added to PATH: $smctlDir"
            }
            
            return $path
        }
    }
    
    # Do a broader search for smctl.exe
    Log-Info "Performing broader search for smctl.exe..."
    $searchLocations = @(
        "C:\Program Files",
        "C:\Program Files (x86)",
        $env:LOCALAPPDATA,
        $env:APPDATA,
        $env:ProgramData
    )
    
    foreach ($location in $searchLocations) {
        if (Test-Path $location) {
            Log-Debug "Searching in: $location"
            $found = Get-ChildItem -Path $location -Filter "smctl.exe" -Recurse -ErrorAction SilentlyContinue | 
                Select-Object -First 1
            
            if ($found) {
                Log-Success "Found smctl.exe at: $($found.FullName)"
                $smctlDir = $found.DirectoryName
                $env:PATH = "$smctlDir;$env:PATH"
                Log-Info "Added to PATH: $smctlDir"
                return $found.FullName
            }
        }
    }
    
    # Last resort - ask user to check manually
    Log-Info "KeyLocker tools not found in standard locations"
    Log-Info "Try running 'where smctl.exe' in a new command prompt to check if it's installed"
    Log-Info ""
    Log-Info "Attempting installation (this may fail if already installed)..."
    
    # Download MSI installer
    $msiUrl = "https://bun-ci-assets.bun.sh/Keylockertools-windows-x64.msi"
    $msiPath = Join-Path $env:TEMP "Keylockertools-windows-x64.msi"
    
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
    
    # Install MSI silently
    $arguments = @(
        "/i", "`"$msiPath`"",
        "/quiet",
        "/norestart",
        "ACCEPT_EULA=1",
        "ADDLOCAL=ALL",
        "ALLUSERS=1"
    )
    
    Log-Debug "Running: msiexec.exe $($arguments -join ' ')"
    
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
        
        # Error 1625 means "This installation is forbidden by system policy"
        # This could mean it's already installed but reconfiguration is blocked
        if ($process.ExitCode -eq 1625) {
            Log-Info "Installation blocked by policy (error 1625), checking if tools are already installed..."
            
            # Re-check for existing installations
            foreach ($path in $smctlPaths) {
                if (Test-Path $path) {
                    Log-Success "Found existing installation at: $path"
                    $smctlDir = Split-Path $path -Parent
                    $env:PATH = "$smctlDir;$env:PATH"
                    return $path
                }
            }
            
            # Check if user has manually specified the location
            if ($env:SMCTL_PATH) {
                Log-Info "Checking user-specified SMCTL_PATH: $env:SMCTL_PATH"
                if (Test-Path $env:SMCTL_PATH) {
                    Log-Success "Found smctl.exe at user-specified location"
                    $smctlDir = Split-Path $env:SMCTL_PATH -Parent
                    $env:PATH = "$smctlDir;$env:PATH"
                    return $env:SMCTL_PATH
                }
            }
            
            Log-Error "DigiCert tools appear to be installed but cannot be found"
            Log-Error "Please locate smctl.exe manually and set SMCTL_PATH environment variable"
            Log-Error "Example: `$env:SMCTL_PATH = 'C:\Path\To\smctl.exe'"
            Log-Error ""
            Log-Error "You can find it by running in a new cmd prompt:"
            Log-Error "  dir C:\Prog* /s /b | findstr smctl.exe"
            throw "Cannot locate smctl.exe - please set SMCTL_PATH environment variable"
        }
        
        throw "MSI installation failed and tools not found"
    }
    
    Log-Success "MSI installation completed"
    
    # Wait for installation to complete
    Start-Sleep -Seconds 5
    
    # Find installed smctl.exe
    foreach ($path in $smctlPaths) {
        if (Test-Path $path) {
            Log-Success "KeyLocker tools installed at: $path"
            $smctlDir = Split-Path $path -Parent
            $env:PATH = "$smctlDir;$env:PATH"
            return $path
        }
    }
    
    # If still not found, search Program Files
    Log-Info "Searching for smctl.exe in Program Files..."
    $searchPaths = @(
        "C:\Program Files",
        "C:\Program Files (x86)",
        $env:LOCALAPPDATA,
        $env:APPDATA
    )
    
    foreach ($basePath in $searchPaths) {
        if (Test-Path $basePath) {
            $found = Get-ChildItem -Path $basePath -Filter "smctl.exe" -Recurse -ErrorAction SilentlyContinue | 
                Select-Object -First 1
            
            if ($found) {
                Log-Success "Found smctl.exe at: $($found.FullName)"
                $smctlDir = $found.DirectoryName
                $env:PATH = "$smctlDir;$env:PATH"
                return $found.FullName
            }
        }
    }
    
    throw "KeyLocker tools installation succeeded but smctl.exe not found"
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
    
    # Configure KeyLocker credentials
    Log-Info "Configuring KeyLocker credentials..."
    
    try {
        # Save credentials
        $saveOutput = & $SmctlPath credentials save $env:SM_API_KEY $env:SM_CLIENT_CERT_PASSWORD 2>&1
        Log-Debug "Credentials save output: $saveOutput"
        
        # Set client certificate
        $certOutput = & $SmctlPath credentials set-client-certificate $env:SM_CLIENT_CERT_FILE 2>&1
        Log-Debug "Set certificate output: $certOutput"
        
        # Test credentials
        Log-Info "Testing KeyLocker credentials..."
        $testOutput = & $SmctlPath credentials test 2>&1 | Out-String
        
        if ($testOutput -like "*Authentication successful*" -or $testOutput -like "*Credentials are valid*") {
            Log-Success "KeyLocker credentials validated successfully"
        } else {
            Log-Error "Credential test output: $testOutput"
            throw "KeyLocker credential validation failed"
        }
        
        # List certificates
        Log-Info "Listing available certificates..."
        $certList = & $SmctlPath certificate list 2>&1 | Out-String
        Log-Debug "Available certificates:`n$certList"
        
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
    
    # Sign the executable
    try {
        $signArgs = @(
            "sign",
            "--input", $ExePath,
            "--keypair-alias", $env:SM_KEYPAIR_ALIAS,
            "--certificate", $env:SM_KEYPAIR_ALIAS,
            "--api-key", $env:SM_API_KEY,
            "--host", $env:SM_HOST,
            "--verbose"
        )
        
        Log-Debug "Running: $SmctlPath $($signArgs -join ' ')"
        
        $signOutput = & $SmctlPath $signArgs 2>&1 | Out-String
        
        if ($LASTEXITCODE -ne 0) {
            Log-Error "Signing output: $signOutput"
            throw "Signing failed with exit code: $LASTEXITCODE"
        }
        
        Log-Debug "Signing output: $signOutput"
        
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