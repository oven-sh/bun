#!/usr/bin/env pwsh

# Test script for Windows code signing setup in Buildkite
# This PowerShell script validates DigiCert KeyLocker configuration

param(
    [switch]$Verbose
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

function Test-Secrets {
    Write-Header "Testing Buildkite Secrets"
    
    # Check if we're in Buildkite
    if (-not $env:BUILDKITE) {
        Write-Warning "Not running in Buildkite environment, skipping secret tests"
        return $false
    }
    
    # Check if buildkite-agent is available
    if (-not (Get-Command "buildkite-agent" -ErrorAction SilentlyContinue)) {
        Write-Warning "buildkite-agent not found, skipping secret tests"
        return $false
    }
    
    # Test DigiCert KeyLocker secrets
    $requiredSecrets = @(
        "SM_API_KEY",
        "SM_HOST",
        "SM_CLIENT_CERT_FILE_B64", 
        "SM_CLIENT_CERT_PASSWORD",
        "SM_CODE_SIGNING_CERT_SHA1_HASH",
        "GITHUB_TOKEN"
    )
    
    $missingSecrets = @()
    
    foreach ($secretName in $requiredSecrets) {
        try {
            $secret = & buildkite-agent secret get $secretName
            if ([string]::IsNullOrEmpty($secret)) {
                $missingSecrets += $secretName
                Write-Error "$secretName is empty"
            } else {
                Write-Success "$secretName is configured"
            }
        } catch {
            $missingSecrets += $secretName
            Write-Error "$secretName is missing"
        }
    }
    
    if ($missingSecrets.Count -gt 0) {
        Write-Error "Missing required secrets: $($missingSecrets -join ', ')"
        Write-Host ""
        Write-Host "Required Buildkite Secrets:"
        Write-Host "  SM_API_KEY: DigiCert Software Trust Manager API key"
        Write-Host "  SM_HOST: DigiCert Software Trust Manager host URL"
        Write-Host "  SM_CLIENT_CERT_FILE_B64: Base64-encoded client certificate"
        Write-Host "  SM_CLIENT_CERT_PASSWORD: Client certificate password"
        Write-Host "  SM_CODE_SIGNING_CERT_SHA1_HASH: Code signing certificate fingerprint"
        Write-Host "  GITHUB_TOKEN: GitHub token for release uploads"
        return $false
    }
    
    Write-Success "All DigiCert KeyLocker secrets are available"
    return $true
}

function Test-Environment {
    Write-Header "Testing Environment"
    
    # Test Windows environment
    Write-Host "PowerShell Version: $($PSVersionTable.PSVersion)"
    Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
    
    if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
        Write-Error "Not running on Windows (PowerShell Core detected)"
        return $false
    }
    
    if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
        Write-Error "PowerShell Core detected but not on Windows"
        return $false
    }
    
    Write-Success "Windows environment confirmed"
    
    # Test common utilities
    $utilities = @(
        @{Name="Invoke-WebRequest"; Test={Get-Command "Invoke-WebRequest" -ErrorAction SilentlyContinue}},
        @{Name="Expand-Archive"; Test={Get-Command "Expand-Archive" -ErrorAction SilentlyContinue}},
        @{Name="Compress-Archive"; Test={Get-Command "Compress-Archive" -ErrorAction SilentlyContinue}}
    )
    
    foreach ($util in $utilities) {
        if (& $util.Test) {
            Write-Success "$($util.Name) is available"
        } else {
            Write-Error "$($util.Name) is missing"
            return $false
        }
    }
    
    return $true
}

function Test-CertificateSetup {
    Write-Header "Testing Certificate Setup"
    
    if (-not $env:BUILDKITE) {
        Write-Warning "Not in Buildkite environment, cannot test certificate"
        return $true
    }
    
    try {
        $certB64 = & buildkite-agent secret get "SM_CLIENT_CERT_FILE_B64"
        if ([string]::IsNullOrEmpty($certB64)) {
            Write-Warning "SM_CLIENT_CERT_FILE_B64 not set, skipping certificate test"
            return $true
        }
        
        # Test base64 decoding
        $certPath = Join-Path $env:TEMP "test_certificate.p12"
        try {
            $certBytes = [System.Convert]::FromBase64String($certB64)
            [System.IO.File]::WriteAllBytes($certPath, $certBytes)
            
            $certSize = (Get-Item $certPath).Length
            Write-Success "Certificate decoded successfully ($certSize bytes)"
            
            Remove-Item $certPath -Force
            return $true
        } catch {
            Write-Error "Failed to decode certificate from base64: $_"
            return $false
        }
    } catch {
        Write-Warning "Could not test certificate: $_"
        return $true
    }
}

function Test-KeyLockerTools {
    Write-Header "Testing DigiCert KeyLocker Tools"
    
    # Test if smctl is already available
    if (Get-Command "smctl" -ErrorAction SilentlyContinue) {
        Write-Success "DigiCert SMCTL is already installed"
        
        # Test health check if environment is configured
        if ($env:SM_HOST -and $env:SM_API_KEY) {
            try {
                & smctl healthcheck
                Write-Success "DigiCert KeyLocker connection successful"
            } catch {
                Write-Error "DigiCert KeyLocker connection failed: $_"
                return $false
            }
        } else {
            Write-Warning "KeyLocker environment not configured, skipping connection test"
        }
        
        return $true
    } else {
        Write-Warning "DigiCert SMCTL not installed, would be installed during signing"
        
        # Test if we can download the installer
        try {
            $smctlUrl = "https://one.digicert.com/signingmanager/api-ui/v1/releases/smtools-windows-x64.msi"
            $testRequest = Invoke-WebRequest -Uri $smctlUrl -Method Head -TimeoutSec 10
            if ($testRequest.StatusCode -eq 200) {
                Write-Success "DigiCert SMCTL installer is accessible"
                return $true
            } else {
                Write-Warning "DigiCert SMCTL installer returned status: $($testRequest.StatusCode)"
                return $true
            }
        } catch {
            Write-Warning "Could not test DigiCert SMCTL installer availability: $_"
            return $true
        }
    }
}

function Test-BuildkiteEnvironment {
    Write-Header "Testing Buildkite Environment"
    
    if (-not $env:BUILDKITE) {
        Write-Warning "Not running in Buildkite environment"
        return $true
    }
    
    Write-Host "Buildkite Build: $env:BUILDKITE_BUILD_NUMBER"
    Write-Host "Pipeline: $env:BUILDKITE_PIPELINE_SLUG"
    Write-Host "Branch: $env:BUILDKITE_BRANCH"
    Write-Host "Repo: $env:BUILDKITE_REPO"
    
    if (Get-Command "buildkite-agent" -ErrorAction SilentlyContinue) {
        Write-Success "buildkite-agent is available"
    } else {
        Write-Error "buildkite-agent command not found"
        return $false
    }
    
    if (Get-Command "gh" -ErrorAction SilentlyContinue) {
        Write-Success "GitHub CLI is available"
    } else {
        Write-Warning "GitHub CLI not found, may need to be installed"
    }
    
    return $true
}

function Main {
    Write-Header "DigiCert KeyLocker Test Suite for Buildkite"
    Write-Host "This script validates the Windows code signing setup"
    
    $testFunctions = @(
        @{Name="Test-Environment"; Func=${function:Test-Environment}},
        @{Name="Test-BuildkiteEnvironment"; Func=${function:Test-BuildkiteEnvironment}},
        @{Name="Test-Secrets"; Func=${function:Test-Secrets}},
        @{Name="Test-CertificateSetup"; Func=${function:Test-CertificateSetup}},
        @{Name="Test-KeyLockerTools"; Func=${function:Test-KeyLockerTools}}
    )
    
    $passed = 0
    $total = $testFunctions.Count
    
    foreach ($test in $testFunctions) {
        try {
            if (& $test.Func) {
                $passed++
            }
        } catch {
            Write-Error "Test $($test.Name) failed with exception: $_"
        }
    }
    
    Write-Header "Test Results"
    Write-Host "Passed: $passed/$total tests"
    
    if ($passed -eq $total) {
        Write-Success "All tests passed! DigiCert KeyLocker setup looks good."
        return 0
    } else {
        Write-Warning "Some tests failed or were skipped. Check the output above."
        return 1
    }
}

# Run tests
exit (Main)