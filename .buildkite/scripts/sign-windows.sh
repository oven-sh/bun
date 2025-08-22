#!/bin/bash
# Windows Code Signing Script for Bun
# Uses DigiCert KeyLocker for Authenticode signing
# Works identically in local and Buildkite environments

set -euo pipefail

# Ensure Git Bash utilities are available when called from PowerShell/CMake
# This fixes "command not found" errors for dirname, tr, cat, rm, etc.
if ! command -v dirname >/dev/null 2>&1; then
    # Add Git Bash utilities to PATH
    export PATH="/c/Program Files/Git/usr/bin:$PATH"
fi

# CRITICAL SECURITY: Disable all debugging and verbose output that could leak secrets
set +x  # Disable command echoing
unset BASH_XTRACEFD 2>/dev/null || true  # Disable trace file descriptor
export PS4=''  # Clear debug prompt to prevent variable expansion leaks

# Prevent accidental secret logging by unsetting debug variables
unset CMAKE_VERBOSE_MAKEFILE 2>/dev/null || true
unset VERBOSE 2>/dev/null || true
unset DEBUG 2>/dev/null || true

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
# Get a working temp directory using Windows-native paths
get_windows_temp_dir() {
    local temp_dir=""
    
    # CRITICAL: Git Bash sets TEMP=/tmp which is NOT the Windows temp directory
    # We must get the actual Windows temp directory
    
    # Method 1: Use cmd.exe to get Windows temp (most reliable)
    if command -v cmd >/dev/null 2>&1; then
        # Get Windows TEMP and convert to Unix path
        local win_temp=$(cmd //c "echo %TEMP%" 2>/dev/null | tr -d '\r\n' || echo "")
        if [[ -n "$win_temp" ]]; then
            # Use cygpath if available, otherwise manual conversion
            if command -v cygpath >/dev/null 2>&1; then
                temp_dir=$(cygpath -u "$win_temp" 2>/dev/null || echo "")
            else
                # Manual conversion: C:\Users\... -> /c/Users/...
                temp_dir=$(echo "$win_temp" | sed 's|\\|/|g' | sed 's|^\([A-Za-z]\):|/\L\1|')
            fi
            if [[ -n "$temp_dir" ]] && [[ -d "$temp_dir" ]] && [[ -w "$temp_dir" ]]; then
                echo "$temp_dir/keylocker-tools"
                return 0
            fi
        fi
    fi
    
    # Method 2: Use PowerShell to get proper temp path
    if command -v powershell >/dev/null 2>&1; then
        temp_dir=$(powershell -Command "[System.IO.Path]::GetTempPath()" 2>/dev/null | tr -d '\r\n' || echo "")
        if [[ -n "$temp_dir" ]]; then
            # Convert Windows path to Unix format for bash
            temp_dir=$(cygpath -u "$temp_dir" 2>/dev/null || echo "$temp_dir")
            # Remove trailing slash to prevent double slashes
            temp_dir="${temp_dir%/}"
            if [[ -d "$temp_dir" ]] && [[ -w "$temp_dir" ]]; then
                echo "$temp_dir/keylocker-tools"
                return 0
            fi
        fi
    fi
    
    # Method 3: Use known Windows temp directory paths
    local current_user="${USER:-${USERNAME:-}}"
    for dir in "/c/Users/$current_user/AppData/Local/Temp" "/c/Windows/Temp" "/c/temp"; do
        if [[ -d "$dir" ]] && [[ -w "$dir" ]]; then
            echo "$dir/keylocker-tools"
            return 0
        fi
    done
    
    # Method 4: Check if USERPROFILE is set and use it
    if [[ -n "${USERPROFILE:-}" ]]; then
        temp_dir=$(cygpath -u "$USERPROFILE/AppData/Local/Temp" 2>/dev/null || echo "")
        if [[ -n "$temp_dir" ]] && [[ -d "$temp_dir" ]] && [[ -w "$temp_dir" ]]; then
            echo "$temp_dir/keylocker-tools"
            return 0
        fi
    fi
    
    # Last resort - use current directory
    echo "./keylocker-tools"
}

TOOLS_DIR="${TOOLS_DIR:-$(get_windows_temp_dir)}"
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
    # Only clean up if we created the temp cert file locally (not in production)
    if [[ -n "${TEMP_CERT:-}" ]] && [[ -f "$TEMP_CERT" ]]; then
        rm -f "$TEMP_CERT"
        log_info "Cleaned up temporary certificate"
    fi
    # Production certificate cleanup is handled by JavaScript process.on('exit')
}

# Set up cleanup trap
trap cleanup EXIT

# Setup certificate - now receives pre-decoded file path from JavaScript
setup_certificate() {
    log_info "Setting up certificate..."
    
    # Check if we have a local test file (for development)
    if [[ -f "$HOME/Downloads/cert_base64.txt" ]]; then
        # Local development environment - decode from file
        log_info "Reading certificate from local development file..."
        TEMP_CERT="/tmp/digicert_cert_$$.p12"
        if cat "$HOME/Downloads/cert_base64.txt" | base64 -d > "$TEMP_CERT" 2>/dev/null; then
            log_info "Certificate decoded successfully from local file"
            export SM_CLIENT_CERT_FILE="$TEMP_CERT"
        else
            log_error "Failed to decode Base64 certificate from local file"
            exit 1
        fi
    else
        # Production environment - certificate already decoded by JavaScript
        log_info "Using pre-decoded certificate file from JavaScript"
        
        # Verify the certificate file exists and is readable
        if [[ ! -f "$SM_CLIENT_CERT_FILE" ]]; then
            log_error "Certificate file not found: $SM_CLIENT_CERT_FILE"
            exit 1
        fi
        
        if [[ ! -r "$SM_CLIENT_CERT_FILE" ]]; then
            log_error "Certificate file not readable: $SM_CLIENT_CERT_FILE"
            exit 1
        fi
        
        if [[ ! -s "$SM_CLIENT_CERT_FILE" ]]; then
            log_error "Certificate file is empty: $SM_CLIENT_CERT_FILE"
            exit 1
        fi
        
        log_info "Certificate file verified successfully"
        # SM_CLIENT_CERT_FILE is already set correctly by JavaScript
    fi
}

# Install DigiCert KeyLocker tools if not present
install_keylocker() {
    # Check multiple possible installation paths (note: case matters - "Keylocker" not "KeyLocker")
    local current_user=$(whoami 2>/dev/null || echo "")
    local smctl_paths=(
        "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe"
        "/c/Program Files (x86)/DigiCert/DigiCert Keylocker Tools/smctl.exe"
        "/c/Program Files/DigiCert/DigiCert One Signing Manager Tools/smctl.exe"
        "/c/Program Files (x86)/DigiCert/DigiCert One Signing Manager Tools/smctl.exe"
        "/c/Users/$current_user/AppData/Local/DigiCert/DigiCert Keylocker Tools/smctl.exe"
        "/c/Users/$current_user/AppData/Roaming/DigiCert/DigiCert Keylocker Tools/smctl.exe"
    )
    
    for path in "${smctl_paths[@]}"; do
        if [[ -f "$path" ]]; then
            log_info "KeyLocker tools already installed at: $path"
            return 0
        fi
    done
    
    log_info "Installing DigiCert KeyLocker tools..."
    log_info "Using tools directory: $TOOLS_DIR"
    
    # Debug: Show actual paths
    log_info "Unix TOOLS_DIR: $TOOLS_DIR"
    local win_tools_dir=$(cygpath -w "$TOOLS_DIR" 2>/dev/null || echo "$TOOLS_DIR")
    log_info "Windows TOOLS_DIR: $win_tools_dir"
    log_info "Git Bash TEMP: ${TEMP:-not set}"
    local actual_win_temp=$(cmd //c "echo %TEMP%" 2>/dev/null | tr -d '\r\n')
    log_info "Actual Windows TEMP: $actual_win_temp"
    
    # Create and verify tools directory
    if [[ ! -d "$TOOLS_DIR" ]]; then
        log_info "Creating tools directory..."
        if ! mkdir -p "$TOOLS_DIR"; then
            log_error "Failed to create directory: $TOOLS_DIR"
            exit 1
        fi
    fi
    
    # Verify directory is accessible and writable
    if [[ ! -d "$TOOLS_DIR" ]]; then
        log_error "Tools directory does not exist after creation: $TOOLS_DIR"
        exit 1
    fi
    
    if [[ ! -w "$TOOLS_DIR" ]]; then
        log_error "Tools directory not writable: $TOOLS_DIR"
        exit 1
    fi
    
    # Download MSI installer with improved error handling
    local msi_path="$TOOLS_DIR/Keylockertools-windows-x64.msi"
    if [[ ! -f "$msi_path" ]]; then
        log_info "Downloading KeyLocker installer..."
        
        # Check disk space on the tools directory
        local available_space
        if available_space=$(df "$TOOLS_DIR" 2>/dev/null | awk 'NR==2 {print $4}'); then
            log_info "Available disk space: ${available_space}K bytes"
        else
            log_info "Could not determine disk space, continuing..."
        fi
        
        # Try downloading with multiple approaches
        local download_success=false
        
        # Method 1: Standard curl with retries and verbose error info
        log_info "Attempting download (method 1: curl with retries)..."
        if curl --fail --show-error --location --retry 3 --retry-delay 5 \
               --connect-timeout 30 --max-time 600 \
               --output "$msi_path" "$KEYLOCKER_URL"; then
            download_success=true
            log_info "Download successful (method 1)"
        else
            log_info "Method 1 failed, trying alternative temp directory..."
            
            # Method 2: Try different temp directory using PowerShell temp path
            if [[ "$download_success" != "true" ]]; then
                log_info "Method 1 failed, trying PowerShell temp directory..."
                local ps_temp_dir
                ps_temp_dir=$(powershell -Command "[System.IO.Path]::GetTempPath()" 2>/dev/null | tr -d '\r\n' || echo "")
                
                if [[ -n "$ps_temp_dir" ]]; then
                    # Convert to Unix path for bash operations  
                    local alt_temp_dir
                    alt_temp_dir=$(cygpath -u "$ps_temp_dir" 2>/dev/null || echo "$ps_temp_dir")
                    # Remove trailing slash to prevent double slashes
                    alt_temp_dir="${alt_temp_dir%/}"
                    alt_temp_dir="$alt_temp_dir/keylocker-$$"
                    
                    log_info "Trying PowerShell temp directory: $alt_temp_dir"
                    if mkdir -p "$alt_temp_dir" 2>/dev/null && [[ -w "$alt_temp_dir" ]]; then
                        local alt_msi_path="$alt_temp_dir/Keylockertools-windows-x64.msi"
                        log_info "Attempting download (method 2: PowerShell temp)..."
                        if curl --fail --show-error --location --retry 2 --retry-delay 3 \
                               --connect-timeout 30 --max-time 600 \
                               --output "$alt_msi_path" "$KEYLOCKER_URL"; then
                            if mv "$alt_msi_path" "$msi_path" 2>/dev/null; then
                                download_success=true
                                log_info "Download successful (method 2)"
                                rm -rf "$alt_temp_dir" 2>/dev/null || true
                            else
                                log_info "Move failed, cleaning up..."
                                rm -rf "$alt_temp_dir" 2>/dev/null || true
                            fi
                        else
                            rm -rf "$alt_temp_dir" 2>/dev/null || true
                        fi
                    else
                        log_info "Could not create PowerShell temp directory"
                    fi
                else
                    log_info "Could not get PowerShell temp path"
                fi
            fi
            
            # Method 3: Try wget as fallback
            if [[ "$download_success" != "true" ]] && command -v wget >/dev/null 2>&1; then
                log_info "Attempting download (method 3: wget)..."
                if wget --tries=2 --timeout=30 --connect-timeout=30 \
                       --output-document="$msi_path" "$KEYLOCKER_URL" >/dev/null 2>&1; then
                    download_success=true
                    log_info "Download successful (method 3)"
                fi
            fi
            
            # Method 4: PowerShell as last resort
            if [[ "$download_success" != "true" ]]; then
                log_info "Attempting download (method 4: PowerShell)..."
                # Convert to Windows path for PowerShell
                local win_msi_path="$(cygpath -w "$msi_path" 2>/dev/null || echo "$msi_path")"
                if powershell -Command "try { Invoke-WebRequest -Uri '$KEYLOCKER_URL' -OutFile '$win_msi_path' -UseBasicParsing -TimeoutSec 300; exit 0 } catch { exit 1 }" >/dev/null 2>&1; then
                    download_success=true
                    log_info "Download successful (method 4)"
                fi
            fi
        fi
        
        if [[ "$download_success" != "true" ]]; then
            log_error "Failed to download KeyLocker installer from $KEYLOCKER_URL"
            log_error "This may be due to network issues, disk space, or permissions"
            log_info "Checking if KeyLocker tools are already installed..."
            if [[ -f "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]]; then
                log_info "KeyLocker tools found, skipping download"
            else
                log_error "KeyLocker tools not found and download failed"
                log_error "Code signing is required for Windows builds"
                exit 1
            fi
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
    
    # Verify the file exists at the Unix path
    if [[ ! -f "$msi_path" ]] || [[ ! -s "$msi_path" ]]; then
        log_error "MSI file is missing or empty at Unix path: $msi_path"
        log_info "Directory contents:"
        ls -la "$TOOLS_DIR" 2>/dev/null || true
        exit 1
    fi
    
    # Verify Windows can access the file
    if ! cmd //c "if exist \"$win_msi_path\" (exit 0) else (exit 1)" 2>/dev/null; then
        log_error "MSI file not accessible from Windows at: $win_msi_path"
        log_info "Attempting to find correct Windows path..."
        
        # Try to get the actual Windows path
        local actual_win_path=$(cmd //c "echo %TEMP%\\keylocker-tools\\Keylockertools-windows-x64.msi" 2>/dev/null | tr -d '\r\n')
        if [[ -n "$actual_win_path" ]]; then
            log_info "Trying Windows temp path: $actual_win_path"
            if cmd //c "if exist \"$actual_win_path\" (exit 0) else (exit 1)" 2>/dev/null; then
                win_msi_path="$actual_win_path"
                log_info "Found MSI at: $win_msi_path"
            fi
        fi
    fi
    
    # Install MSI with comprehensive automation and better error detection
    log_info "Running MSI installer..."
    log_info "MSI file Unix path: $msi_path"
    log_info "MSI file Windows path: $win_msi_path"
    
    local file_size=$(wc -c < "$msi_path" | tr -d ' ')
    log_info "MSI file size: $file_size bytes"
    
    # Check if running with administrator privileges
    if command -v powershell >/dev/null 2>&1; then
        local is_admin=$(powershell -Command "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)" 2>/dev/null || echo "False")
        log_info "Running with administrator privileges: $is_admin"
    fi
    
    # Try multiple installation approaches with better error detection
    local install_success=false
    
    # Create log file in Windows temp directory
    local win_temp_dir=$(cmd //c "echo %TEMP%" 2>/dev/null | tr -d '\r\n')
    local install_log_path="${win_temp_dir}\\keylocker-install-$$.log"
    
    # Method 1: Direct msiexec with full automation and proper logging
    log_info "Attempting MSI installation (method 1: direct msiexec)..."
    local msi_exit_code=0
    
    # Run msiexec and capture exit code (without log file if it causes issues)
    cmd //c "msiexec.exe /i \"$win_msi_path\" /quiet /norestart ACCEPT_EULA=1 ADDLOCAL=ALL ALLUSERS=1" 2>&1
    msi_exit_code=$?
    
    log_info "MSI installer command completed with exit code: $msi_exit_code"
    sleep 20  # Wait for installation to complete
    
    # Check if tools were actually installed  
    if [[ -f "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]] || 
       [[ -f "/c/Program Files (x86)/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]]; then
        install_success=true
        log_info "MSI installation verified successful (method 1)"
    else
        log_info "MSI exit code $msi_exit_code but tools not found, trying method 2..."
        
        # List what's actually in Program Files after installation
        log_info "Contents of /c/Program Files after installation:"
        ls -la "/c/Program Files/" 2>/dev/null | grep -i digicert || true
        log_info "Contents of /c/Program Files (x86) after installation:"  
        ls -la "/c/Program Files (x86)/" 2>/dev/null | grep -i digicert || true
    fi
    
    # Method 2: PowerShell with explicit admin elevation request
    if [[ "$install_success" != "true" ]]; then
        log_info "Attempting MSI installation (method 2: PowerShell with admin request)..."
        if powershell -Command "
            try { 
                \$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', '\"$win_msi_path\"', '/quiet', '/norestart', 'ACCEPT_EULA=1', 'ADDLOCAL=ALL', 'ALLUSERS=1' -Wait -PassThru -Verb RunAs -NoNewWindow
                Write-Host \"MSI exit code with elevation: \$(\$process.ExitCode)\"
                exit \$process.ExitCode
            } catch { 
                Write-Host \"PowerShell elevation error: \$(\$_.Exception.Message)\"
                # Try without elevation as fallback
                try {
                    \$process2 = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', '\"$win_msi_path\"', '/quiet', '/norestart', 'ACCEPT_EULA=1', 'ADDLOCAL=ALL', 'ALLUSERS=0' -Wait -PassThru -NoNewWindow
                    Write-Host \"MSI exit code without elevation: \$(\$process2.ExitCode)\"
                    exit \$process2.ExitCode
                } catch {
                    Write-Host \"PowerShell fallback error: \$(\$_.Exception.Message)\"
                    exit 1
                }
            }" 2>&1; then
            log_info "PowerShell MSI installation completed"
            sleep 30
            
            # Check both system and user installation locations
            if [[ -f "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]] || 
               [[ -f "/c/Program Files (x86)/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]] ||
               [[ -f "/c/Users/$(whoami)/AppData/Local/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]]; then
                install_success=true
                log_info "MSI installation verified successful (method 2)"
            fi
        fi
    fi
    
    # Method 3: Try with /passive mode if still failing
    if [[ "$install_success" != "true" ]]; then
        log_info "Attempting MSI installation (method 3: passive mode)..."
        cmd //c "msiexec.exe /i \"$win_msi_path\" /passive /norestart ACCEPT_EULA=1 ADDLOCAL=ALL ALLUSERS=1" >/dev/null 2>&1 &
        local msi_pid=$!
        
        # Wait up to 60 seconds for installation
        for i in {1..60}; do
            if [[ -f "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]] || 
               [[ -f "/c/Program Files (x86)/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]] ||
               [[ -f "/c/Users/$(whoami)/AppData/Local/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]] ||
               [[ -f "/c/Users/$(whoami)/AppData/Roaming/DigiCert/DigiCert Keylocker Tools/smctl.exe" ]]; then
                install_success=true
                log_info "MSI installation verified successful (method 3)"
                break
            fi
            sleep 1
        done
        
        # Kill MSI process if still running
        kill $msi_pid 2>/dev/null || true
    fi
    
    # Final wait for any remaining installation processes
    sleep 10
    
    # Verify installation with multiple possible paths (system and user)
    local smctl_found=false
    local current_user=$(whoami 2>/dev/null || echo "")
    local smctl_paths=(
        "/c/Program Files/DigiCert/DigiCert Keylocker Tools/smctl.exe"
        "/c/Program Files (x86)/DigiCert/DigiCert Keylocker Tools/smctl.exe" 
        "/c/ProgramFiles/DigiCert/DigiCert Keylocker Tools/smctl.exe"
        "/c/Users/$current_user/AppData/Local/DigiCert/DigiCert Keylocker Tools/smctl.exe"
        "/c/Users/$current_user/AppData/Roaming/DigiCert/DigiCert Keylocker Tools/smctl.exe"
    )
    
    for path in "${smctl_paths[@]}"; do
        if [[ -f "$path" ]]; then
            log_info "Found KeyLocker tools at: $path"
            smctl_found=true
            break
        fi
    done
    
    if [[ "$smctl_found" != "true" ]]; then
        log_error "KeyLocker tools installation failed - smctl.exe not found"
        log_error "Searched paths:"
        for path in "${smctl_paths[@]}"; do
            log_error "  $path"
        done
        log_error "Please ensure you have administrator privileges"
        
        # Comprehensive search for KeyLocker installation
        log_info "Searching for smctl.exe in all possible locations..."
        
        # Method 1: Search common program directories (system and user)
        local current_user_search=$(whoami 2>/dev/null || echo "buildkite-agent")
        local search_paths=(
            "/c/Program Files"
            "/c/Program Files (x86)" 
            "/c/ProgramData"
            "/c/Users/$current_user_search/AppData/Local"
            "/c/Users/$current_user_search/AppData/Roaming"
            "/c/Users/*/AppData/Local"
            "/c/Users/*/AppData/Roaming"
            "/c/Windows/System32"
            "/c/Windows/SysWOW64"
        )
        
        for search_path in "${search_paths[@]}"; do
            if [[ -d "$search_path" ]]; then
                log_info "Searching in: $search_path"
                find "$search_path" -name "smctl.exe" 2>/dev/null | head -5 | while read -r found_path; do
                    log_info "Found smctl.exe at: $found_path"
                done
            fi
        done
        
        # Method 2: Search for DigiCert directories
        log_info "Searching for DigiCert directories..."
        find /c/ -type d -name "*DigiCert*" 2>/dev/null | head -10 | while read -r dir; do
            log_info "Found DigiCert directory: $dir"
            if [[ -f "$dir/smctl.exe" ]]; then
                log_info "  Contains smctl.exe!"
            fi
        done
        
        # Method 3: Search for any KeyLocker-related files
        log_info "Searching for KeyLocker-related files..."
        find /c/ -name "*keylocker*" -o -name "*smctl*" 2>/dev/null | head -10 | while read -r file; do
            log_info "Found KeyLocker-related file: $file"
        done
        
        # Method 4: Check Windows registry for installation path (if possible)
        if command -v reg >/dev/null 2>&1; then
            log_info "Checking Windows registry for DigiCert installations..."
            reg query "HKLM\\SOFTWARE\\DigiCert" /s 2>/dev/null | grep -i "keylocker\|smctl" || true
            reg query "HKLM\\SOFTWARE\\WOW6432Node\\DigiCert" /s 2>/dev/null | grep -i "keylocker\|smctl" || true
        fi
        
        # Method 5: List all recently installed programs
        if command -v powershell >/dev/null 2>&1; then
            log_info "Checking installed programs for DigiCert..."
            powershell -Command "Get-WmiObject -Class Win32_Product | Where-Object { \$_.Name -like '*DigiCert*' } | Select-Object Name, InstallLocation" 2>/dev/null || true
        fi
        
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
    
    # Add KeyLocker tools to PATH - find the actual installation directory
    local smctl_path=""
    local current_user=$(whoami 2>/dev/null || echo "")
    local smctl_paths=(
        "/c/Program Files/DigiCert/DigiCert Keylocker Tools"
        "/c/Program Files (x86)/DigiCert/DigiCert Keylocker Tools"
        "/c/Program Files/DigiCert/DigiCert One Signing Manager Tools"
        "/c/Program Files (x86)/DigiCert/DigiCert One Signing Manager Tools"
        "/c/ProgramFiles/DigiCert/DigiCert Keylocker Tools"
        "/c/Users/$current_user/AppData/Local/DigiCert/DigiCert Keylocker Tools"
        "/c/Users/$current_user/AppData/Roaming/DigiCert/DigiCert Keylocker Tools"
    )
    
    for path in "${smctl_paths[@]}"; do
        if [[ -f "$path/smctl.exe" ]]; then
            smctl_path="$path"
            break
        fi
    done
    
    if [[ -n "$smctl_path" ]]; then
        if [[ ":$PATH:" != *":$smctl_path:"* ]]; then
            export PATH="$PATH:$smctl_path"
            log_info "Added KeyLocker tools to PATH: $smctl_path"
        else
            log_info "KeyLocker tools already in PATH: $smctl_path"
        fi
    else
        log_error "Could not find KeyLocker tools to add to PATH"
        log_info "Searching for smctl.exe..."
        find "/c/Program Files" "/c/Program Files (x86)" -name "smctl.exe" 2>/dev/null | head -10
        exit 1
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
        log_info "File not found, skipping: $exe_path"
        return 0
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
    
    # Check if any files actually exist to sign
    local files_exist=false
    for file in "$@"; do
        if [[ -f "$file" ]]; then
            files_exist=true
            break
        fi
    done
    
    if [[ "$files_exist" != "true" ]]; then
        log_error "No files to sign found - build should have created executables"
        exit 1
    fi
    
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