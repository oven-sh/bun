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

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="${TOOLS_DIR:-/tmp/keylocker-tools}"
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
    
    # Download MSI installer
    local msi_path="$TOOLS_DIR/Keylockertools-windows-x64.msi"
    if [[ ! -f "$msi_path" ]]; then
        log_info "Downloading KeyLocker installer..."
        if ! curl -fsSL -o "$msi_path" "$KEYLOCKER_URL"; then
            log_error "Failed to download KeyLocker installer from $KEYLOCKER_URL"
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
    
    # Install MSI
    log_info "Running MSI installer..."
    if cmd //c "msiexec.exe /i \"$win_msi_path\" /qn /norestart ACCEPT_EULA=1 ADDLOCAL=ALL" 2>/dev/null; then
        log_info "MSI installation completed"
    else
        # Try with PowerShell elevation if direct install fails
        log_info "Attempting installation with elevated privileges..."
        powershell -Command "Start-Process msiexec.exe -ArgumentList '/i', '\"$win_msi_path\"', '/qn', '/norestart', 'ACCEPT_EULA=1', 'ADDLOCAL=ALL' -Verb RunAs -Wait" 2>/dev/null || true
    fi
    
    # Wait for installation to complete
    sleep 10
    
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
    
    # Save credentials to Windows credential store
    log_info "Saving credentials..."
    if ! smctl credentials save "$SM_API_KEY" "$SM_CLIENT_CERT_PASSWORD" 2>/dev/null; then
        log_error "Failed to save credentials"
        exit 1
    fi
    
    # Sync certificates with Windows certificate store
    log_info "Syncing certificates..."
    if ! smctl windows certsync --keypair-alias="$SM_KEYPAIR_ALIAS" 2>/dev/null; then
        log_error "Failed to sync certificates"
        exit 1
    fi
    
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
    
    # Sign with smctl
    if ! smctl sign --keypair-alias="$SM_KEYPAIR_ALIAS" --input "$win_path" 2>&1 | grep -q "SUCCESSFUL"; then
        log_error "Failed to sign $exe_name"
        return 1
    fi
    
    log_success "Signed $exe_name"
    
    # Verify signature with smctl
    log_info "Verifying signature for $exe_name..."
    if ! smctl sign verify --input "$win_path" 2>&1 | grep -q -E "(Valid|Success|Verified)"; then
        # Try alternate verification
        if ! signtool verify //pa "$win_path" 2>&1 | grep -q "Successfully verified"; then
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