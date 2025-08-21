#!/bin/bash
# Windows Code Signing Script for Bun
# Uses DigiCert KeyLocker for Authenticode signing
# Works identically in local and Buildkite environments

set -euo pipefail

# Required environment variables (must be set locally or by Buildkite)
: "${SM_API_KEY:?Error: SM_API_KEY environment variable is required}"
: "${SM_CLIENT_CERT_PASSWORD:?Error: SM_CLIENT_CERT_PASSWORD environment variable is required}"
: "${SM_KEYPAIR_ALIAS:?Error: SM_KEYPAIR_ALIAS environment variable is required}"
: "${SM_HOST:?Error: SM_HOST environment variable is required}"
: "${SM_CLIENT_CERT_FILE:?Error: SM_CLIENT_CERT_FILE environment variable is required (Base64-encoded certificate content)}"

# Verify all required environment variables are present and non-empty
verify_env_vars() {
    local missing_vars=()
    
    [[ -z "${SM_API_KEY:-}" ]] && missing_vars+=("SM_API_KEY")
    [[ -z "${SM_CLIENT_CERT_PASSWORD:-}" ]] && missing_vars+=("SM_CLIENT_CERT_PASSWORD")
    [[ -z "${SM_KEYPAIR_ALIAS:-}" ]] && missing_vars+=("SM_KEYPAIR_ALIAS")
    [[ -z "${SM_HOST:-}" ]] && missing_vars+=("SM_HOST")
    [[ -z "${SM_CLIENT_CERT_FILE:-}" ]] && missing_vars+=("SM_CLIENT_CERT_FILE")
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing required environment variables: ${missing_vars[*]}"
        log_error "These should be set by Buildkite secrets or local environment"
        exit 1
    fi
    
    log_info "All required environment variables are present"
}

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Try multiple possible temp directories
if [[ -w "/tmp" ]]; then
    TOOLS_DIR="${TOOLS_DIR:-/tmp/keylocker-tools}"
elif [[ -w "$HOME" ]]; then
    TOOLS_DIR="${TOOLS_DIR:-$HOME/keylocker-tools}"
elif [[ -w "." ]]; then
    TOOLS_DIR="${TOOLS_DIR:-./keylocker-tools}"
else
    TOOLS_DIR="${TOOLS_DIR:-/tmp/keylocker-tools}"
fi
KEYLOCKER_URL="https://bun-ci-assets.bun.sh/Keylockertools-windows-x64.msi"

# Logging functions
log_info() {
    echo "[INFO] $1"
}

log_error() {
    echo "[ERROR] $1" >&2
}

log_success() {
    echo "[SUCCESS] $1"
}

# Secure logging function that never echoes sensitive data
log_secure() {
    echo "[INFO] $1" >/dev/null 2>&1
}

# Cleanup function
cleanup() {
    if [[ -n "${TEMP_CERT:-}" ]] && [[ -f "$TEMP_CERT" ]]; then
        rm -f "$TEMP_CERT"
        log_info "Cleaned up temporary certificate"
    fi
}

# Set up cleanup trap
trap cleanup EXIT

# Decode Base64 certificate to temporary file
setup_certificate() {
    log_info "Setting up certificate..."
    
    # Create secure temporary certificate file
    TEMP_CERT="/tmp/digicert_cert_$$.p12"
    
    # Check if we need to read from file or use the variable directly
    if [[ -f "$HOME/Downloads/cert_base64.txt" ]]; then
        # In local environment, read from file
        log_info "Reading certificate from local file..."
        if cat "$HOME/Downloads/cert_base64.txt" | base64 -d > "$TEMP_CERT" 2>/dev/null; then
            log_info "Certificate decoded successfully from file"
        else
            log_error "Failed to decode Base64 certificate from file"
            exit 1
        fi
    else
        # In CI environment, use variable directly
        log_info "Using certificate from environment variable..."
        if echo "$SM_CLIENT_CERT_FILE" | base64 -d > "$TEMP_CERT" 2>/dev/null; then
            log_info "Certificate decoded successfully"
        else
            log_error "Failed to decode Base64 certificate"
            exit 1
        fi
    fi
    
    # Verify certificate file was created
    if [[ ! -f "$TEMP_CERT" ]] || [[ ! -s "$TEMP_CERT" ]]; then
        log_error "Certificate file is empty or was not created"
        exit 1
    fi
    
    # Update environment variable to point to decoded certificate
    export SM_CLIENT_CERT_FILE="$TEMP_CERT"
}

# Install DigiCert KeyLocker tools if not present
install_keylocker() {
    if [[ -f "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]]; then
        log_info "KeyLocker tools already installed"
        return 0
    fi
    
    log_info "Installing DigiCert KeyLocker tools..."
    mkdir -p "$TOOLS_DIR"
    
    # Download MSI installer with improved error handling
    local msi_path="$TOOLS_DIR/Keylockertools-windows-x64.msi"
    if [[ ! -f "$msi_path" ]]; then
        log_info "Downloading KeyLocker installer..."
        
        # Check disk space
        local available_space=$(df "$TOOLS_DIR" | awk 'NR==2 {print $4}')
        log_info "Available disk space: ${available_space}K bytes"
        
        # Ensure directory exists and is writable
        if [[ ! -d "$TOOLS_DIR" ]]; then
            mkdir -p "$TOOLS_DIR" || {
                log_error "Failed to create directory: $TOOLS_DIR"
                exit 1
            }
        fi
        
        if [[ ! -w "$TOOLS_DIR" ]]; then
            log_error "Directory not writable: $TOOLS_DIR"
            exit 1
        fi
        
        # Try downloading with multiple approaches
        local download_success=false
        
        # Method 1: Standard curl with progress and retries
        log_info "Attempting download (method 1)..."
        if curl --fail --show-error --location --retry 3 --retry-delay 5 \
               --connect-timeout 30 --max-time 300 \
               --output "$msi_path" "$KEYLOCKER_URL" 2>/dev/null; then
            download_success=true
            log_info "Download successful (method 1)"
        else
            log_info "Method 1 failed, trying alternative..."
            
            # Method 2: Use temporary file first, then move
            local temp_file="$TOOLS_DIR/keylocker_temp_$$.msi"
            if curl --fail --show-error --location --retry 2 \
                   --connect-timeout 30 --max-time 300 \
                   --output "$temp_file" "$KEYLOCKER_URL" 2>/dev/null; then
                if mv "$temp_file" "$msi_path" 2>/dev/null; then
                    download_success=true
                    log_info "Download successful (method 2)"
                else
                    rm -f "$temp_file" 2>/dev/null || true
                fi
            else
                rm -f "$temp_file" 2>/dev/null || true
            fi
        fi
        
        if [[ "$download_success" != "true" ]]; then
            log_error "Failed to download KeyLocker installer from $KEYLOCKER_URL"
            log_error "This may be due to network issues, disk space, or permissions"
            exit 1
        fi
    fi
    
    # Verify download
    local file_size=$(wc -c < "$msi_path" | tr -d ' ')
    if [[ "$file_size" -lt 1000000 ]]; then
        log_error "Downloaded file appears invalid (size: $file_size bytes)"
        rm -f "$msi_path"
        exit 1
    fi
    
    # Convert path for Windows
    local win_msi_path="$(cygpath -w "$msi_path" 2>/dev/null || echo "$msi_path")"
    
    # Install MSI with comprehensive automation
    log_info "Running MSI installer..."
    
    # Try multiple installation approaches
    local install_success=false
    
    # Method 1: Direct msiexec with full automation
    if cmd //c "msiexec.exe /i \"$win_msi_path\" /quiet /norestart /L*V /tmp/keylocker-install.log ACCEPT_EULA=1 ADDLOCAL=ALL ALLUSERS=1" >/dev/null 2>&1; then
        install_success=true
        log_info "MSI installation completed (method 1)"
    else
        # Method 2: PowerShell with elevated privileges and wait
        log_info "Attempting installation with elevated privileges..."
        if powershell -Command "try { Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', '\"$win_msi_path\"', '/quiet', '/norestart', '/L*V', '/tmp/keylocker-install.log', 'ACCEPT_EULA=1', 'ADDLOCAL=ALL', 'ALLUSERS=1' -Verb RunAs -Wait -PassThru | Out-Null; exit 0 } catch { exit 1 }" >/dev/null 2>&1; then
            install_success=true
            log_info "MSI installation completed (method 2)"
        else
            # Method 3: Try without elevation but with longer wait
            log_info "Trying installation without elevation..."
            cmd //c "msiexec.exe /i \"$win_msi_path\" /passive /norestart /L*V /tmp/keylocker-install.log ACCEPT_EULA=1 ADDLOCAL=ALL" >/dev/null 2>&1 &
            sleep 30
            if [[ -f "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]]; then
                install_success=true
                log_info "MSI installation completed (method 3)"
            fi
        fi
    fi
    
    # Wait additional time for installation to fully complete
    sleep 15
    
    # Verify installation
    if [[ ! -f "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]]; then
        log_error "KeyLocker tools installation failed"
        log_error "Please ensure you have administrator privileges"
        exit 1
    fi
    
    log_success "KeyLocker tools installed successfully"
}

# Setup environment and credentials
setup_environment() {
    log_info "Setting up environment..."
    
    # Export required environment variables
    export SM_HOST="$SM_HOST"
    export SM_API_KEY="$SM_API_KEY"
    export SM_CLIENT_CERT_PASSWORD="$SM_CLIENT_CERT_PASSWORD"
    
    # Add KeyLocker tools to PATH
    local smctl_path="/c/Program Files/DigiCert/DigiCert Keylocker Tools"
    if [[ ":$PATH:" != *":$smctl_path:"* ]]; then
        export PATH="$PATH:$smctl_path"
    fi
    
    # Find and add signtool to PATH
    local signtool_found=false
    for version in "10.0.26100.0" "10.0.22621.0" "10.0.22000.0" "10.0.19041.0"; do
        local signtool_path="/c/Program Files (x86)/Windows Kits/10/bin/$version/x64"
        if [[ -f "$signtool_path/signtool.exe" ]]; then
            if [[ ":$PATH:" != *":$signtool_path:"* ]]; then
                export PATH="$PATH:$signtool_path"
            fi
            signtool_found=true
            break
        fi
    done
    
    if [[ "$signtool_found" == false ]]; then
        log_error "signtool.exe not found in Windows SDK"
        exit 1
    fi
    
    # Save credentials to Windows credential store (no logging to prevent exposure)
    if ! smctl credentials save "$SM_API_KEY" "$SM_CLIENT_CERT_PASSWORD" >/dev/null 2>&1; then
        log_error "Failed to save credentials"
        exit 1
    fi
    log_info "Credentials saved securely"
    
    # Sync certificates with Windows certificate store (no logging to prevent exposure)
    if ! smctl windows certsync --keypair-alias="$SM_KEYPAIR_ALIAS" >/dev/null 2>&1; then
        log_error "Failed to sync certificates"
        exit 1
    fi
    log_info "Certificates synced successfully"
    
    log_success "Environment setup completed"
}

# Sign a single executable
sign_executable() {
    local exe_path="$1"
    
    if [[ ! -f "$exe_path" ]]; then
        log_error "File not found: $exe_path"
        return 1
    fi
    
    # Convert to Windows path
    local win_path="$(cygpath -w "$exe_path" 2>/dev/null || echo "$exe_path")"
    local exe_name="$(basename "$exe_path")"
    
    log_info "Signing $exe_name..."
    
    # Sign with smctl (suppress output to prevent credential exposure)
    if ! smctl sign --keypair-alias="$SM_KEYPAIR_ALIAS" --input "$win_path" >/dev/null 2>&1; then
        log_error "Failed to sign $exe_name"
        return 1
    fi
    
    log_success "Signed $exe_name"
    
    # Verify signature with smctl (suppress output to prevent info exposure)
    log_info "Verifying signature for $exe_name..."
    if ! smctl sign verify --input "$win_path" >/dev/null 2>&1; then
        # Try alternate verification with signtool
        if ! signtool verify //pa "$win_path" >/dev/null 2>&1; then
            log_error "Signature verification failed for $exe_name"
            return 1
        fi
    fi
    
    log_success "Signature verified for $exe_name"
    return 0
}

# Main function
main() {
    if [[ $# -eq 0 ]]; then
        log_error "Usage: $0 <executable1> [executable2] ..."
        exit 1
    fi
    
    log_info "Starting Windows code signing process..."
    
    # Verify environment variables
    verify_env_vars
    
    # Setup certificate from Base64
    setup_certificate
    
    # Install KeyLocker if needed
    install_keylocker
    
    # Setup environment
    setup_environment
    
    # Sign all provided executables
    local failed=0
    local succeeded=0
    
    for exe in "$@"; do
        if sign_executable "$exe"; then
            succeeded=$((succeeded + 1))
        else
            failed=$((failed + 1))
            log_error "Failed to sign: $exe"
        fi
    done
    
    # Summary
    echo "----------------------------------------"
    log_info "Signing complete:"
    log_info "  Succeeded: $succeeded"
    if [[ $failed -gt 0 ]]; then
        log_error "  Failed: $failed"
        exit 1
    fi
    
    log_success "All executables signed successfully!"
    return 0
}

# Run main function
main "$@"