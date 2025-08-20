#!/bin/bash

set -eo pipefail

# Import common functions from upload-release.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/upload-release.sh"

function assert_digicer_keylocker() {
  echo "Checking DigiCert KeyLocker secrets..."
  
  # Check all required secrets for DigiCert KeyLocker
  local required_secrets=(
    "SM_API_KEY"
    "SM_HOST"
    "SM_CLIENT_CERT_FILE_B64"
    "SM_CLIENT_CERT_PASSWORD"
    "SM_CODE_SIGNING_CERT_SHA1_HASH"
  )
  
  for secret in "${required_secrets[@]}"; do
    assert_buildkite_secret "$secret"
  done
  
  echo "✓ All DigiCert KeyLocker secrets are configured"
}

function setup_digicer_keylocker() {
  echo "Setting up DigiCert KeyLocker..."
  
  # Create client certificate file from base64 secret
  local cert_path="/tmp/client_certificate.p12"
  echo "$SM_CLIENT_CERT_FILE_B64" | base64 -d > "$cert_path"
  
  # Export environment variables for DigiCert KeyLocker
  export SM_CLIENT_CERT_FILE="$cert_path"
  
  echo "✓ DigiCert KeyLocker setup complete"
  echo "  Host: $SM_HOST"
  echo "  Certificate: $cert_path"
  echo "  Fingerprint: $SM_CODE_SIGNING_CERT_SHA1_HASH"
}

function install_digicer_tools() {
  echo "Installing DigiCert KeyLocker tools..."
  
  # Check if we're on Windows (Buildkite Windows agents)
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    echo "Detected Windows environment"
    
    # Download and install DigiCert SMCTL tool
    local smctl_url="https://one.digicert.com/signingmanager/api-ui/v1/releases/smtools-windows-x64.msi"
    local smctl_installer="/tmp/smtools-windows-x64.msi"
    
    echo "Downloading DigiCert SMCTL..."
    curl -L "$smctl_url" -o "$smctl_installer"
    
    echo "Installing DigiCert SMCTL..."
    msiexec /i "$smctl_installer" /quiet /norestart
    
    # Add to PATH
    export PATH="/c/Program Files/DigiCert/DigiCert One Signing Manager Tools:$PATH"
    
    # Verify installation
    if ! command -v smctl &> /dev/null; then
      echo "error: smctl installation failed"
      exit 1
    fi
    
    echo "✓ DigiCert SMCTL installed successfully"
  else
    echo "error: Windows code signing can only run on Windows agents"
    exit 1
  fi
}

function test_keylocker_connection() {
  echo "Testing DigiCert KeyLocker connection..."
  
  # Test health check
  if ! smctl healthcheck; then
    echo "error: DigiCert KeyLocker health check failed"
    exit 1
  fi
  
  echo "✓ DigiCert KeyLocker connection successful"
  
  # List available certificates
  echo "Available certificates in KeyLocker:"
  smctl keypair ls
  
  # Verify our specific certificate exists
  if ! smctl keypair ls | grep -i "$SM_CODE_SIGNING_CERT_SHA1_HASH"; then
    echo "error: Certificate with fingerprint $SM_CODE_SIGNING_CERT_SHA1_HASH not found in KeyLocker"
    echo "Available certificates:"
    smctl keypair ls
    exit 1
  fi
  
  echo "✓ Certificate fingerprint found in KeyLocker"
}

function sign_windows_binaries() {
  local version="$1"
  local tag="$(release_tag "$version")"
  
  echo "Signing Windows binaries for version: $version (tag: $tag)"
  
  # Windows binaries to sign (matching upload-release.sh artifacts list)
  local windows_artifacts=(
    "bun-windows-x64.zip"
    "bun-windows-x64-profile.zip"
    "bun-windows-x64-baseline.zip"
    "bun-windows-x64-baseline-profile.zip"
  )
  
  # Create working directories
  local work_dir="/tmp/windows-signing"
  local download_dir="$work_dir/downloads"
  local extract_dir="$work_dir/extracted"
  local signed_dir="$work_dir/signed"
  
  mkdir -p "$download_dir" "$extract_dir" "$signed_dir"
  
  for artifact in "${windows_artifacts[@]}"; do
    echo ""
    echo "=== Processing $artifact ==="
    
    # Download artifact from Buildkite
    echo "Downloading Buildkite artifact: $artifact"
    download_buildkite_artifact "$artifact" "$download_dir"
    
    local artifact_path="$download_dir/$artifact"
    if [[ ! -f "$artifact_path" ]]; then
      echo "warn: Artifact $artifact not found, skipping"
      continue
    fi
    
    # Extract the zip file
    local extract_path="$extract_dir/${artifact%.zip}"
    echo "Extracting to: $extract_path"
    mkdir -p "$extract_path"
    unzip -q "$artifact_path" -d "$extract_path"
    
    # Find and sign all .exe files
    local exe_files=()
    while IFS= read -r -d '' exe_file; do
      exe_files+=("$exe_file")
    done < <(find "$extract_path" -name "*.exe" -print0)
    
    if [[ ${#exe_files[@]} -eq 0 ]]; then
      echo "warn: No .exe files found in $artifact"
      continue
    fi
    
    echo "Found ${#exe_files[@]} executable files to sign:"
    for exe_file in "${exe_files[@]}"; do
      echo "  - $exe_file"
    done
    
    # Sign each executable
    for exe_file in "${exe_files[@]}"; do
      local exe_name="$(basename "$exe_file")"
      echo "Signing $exe_name with DigiCert KeyLocker..."
      
      # Use smctl to sign the binary
      if ! smctl sign --fingerprint "$SM_CODE_SIGNING_CERT_SHA1_HASH" --input "$exe_file"; then
        echo "error: Failed to sign $exe_name"
        exit 1
      fi
      
      # Verify the signature using signtool (if available)
      if command -v signtool &> /dev/null; then
        echo "Verifying signature for $exe_name..."
        if ! signtool verify /pa /v "$exe_file"; then
          echo "error: Signature verification failed for $exe_name"
          exit 1
        fi
      fi
      
      echo "✓ Successfully signed and verified $exe_name"
    done
    
    # Repackage the signed binaries
    local signed_artifact="$signed_dir/$artifact"
    echo "Repackaging signed binaries to: $signed_artifact"
    (cd "$extract_path" && zip -r "$signed_artifact" .)
    
    echo "✓ Created signed package: $artifact"
  done
  
  echo ""
  echo "=== Signing Summary ==="
  local signed_files=($(find "$signed_dir" -name "*.zip"))
  echo "Successfully signed ${#signed_files[@]} Windows packages:"
  for signed_file in "${signed_files[@]}"; do
    local filename="$(basename "$signed_file")"
    local size="$(du -h "$signed_file" | cut -f1)"
    echo "  ✓ $filename ($size)"
  done
  
  # Upload signed binaries back to GitHub release
  echo ""
  echo "=== Uploading Signed Binaries ==="
  for signed_file in "${signed_files[@]}"; do
    local filename="$(basename "$signed_file")"
    echo "Uploading signed binary: $filename"
    upload_github_asset "$version" "$signed_file"
    echo "✓ Uploaded $filename to GitHub release"
  done
  
  # Cleanup
  echo ""
  echo "Cleaning up temporary files..."
  rm -rf "$work_dir"
  rm -f "/tmp/client_certificate.p12"
  echo "✓ Cleanup complete"
}

function sign_windows_release() {
  local version="$1"
  
  if [[ -z "$version" ]]; then
    echo "error: Version parameter is required"
    echo "usage: $0 <version>"
    echo "example: $0 canary"
    echo "example: $0 1.2.3"
    exit 1
  fi
  
  echo "Starting Windows code signing process for version: $version"
  
  # Validate environment
  assert_main
  assert_buildkite_agent
  assert_github
  assert_digicer_keylocker
  
  # Setup DigiCert KeyLocker
  setup_digicer_keylocker
  install_digicer_tools
  test_keylocker_connection
  
  # Sign Windows binaries
  sign_windows_binaries "$version"
  
  echo ""
  echo "=== Windows Code Signing Complete ==="
  echo "✓ All Windows binaries have been signed with DigiCert KeyLocker"
  echo "✓ Signed binaries uploaded to GitHub release: $(release_tag "$version")"
}

# Main execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  sign_windows_release "$@"
fi