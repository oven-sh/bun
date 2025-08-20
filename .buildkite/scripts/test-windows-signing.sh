#!/bin/bash

set -eo pipefail

# Test script for Windows code signing setup
# This can be run independently to validate DigiCert KeyLocker configuration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Testing DigiCert KeyLocker Setup ==="
echo "This script tests the DigiCert KeyLocker configuration for Windows code signing"
echo ""

# Source the signing script functions
source "$SCRIPT_DIR/sign-windows.sh"

function test_secrets() {
  echo "1. Testing Buildkite secrets..."
  
  # Check if we're in a Buildkite environment
  if [[ -z "$BUILDKITE" ]]; then
    echo "warn: Not running in Buildkite environment, skipping secret tests"
    return 0
  fi
  
  # Check if buildkite-agent is available
  if ! command -v buildkite-agent &> /dev/null; then
    echo "warn: buildkite-agent not found, skipping secret tests"
    return 0
  fi
  
  # Test DigiCert KeyLocker secrets
  assert_digicer_keylocker
  echo "✓ All DigiCert KeyLocker secrets are available"
}

function test_environment() {
  echo "2. Testing environment setup..."
  
  # Test OS detection
  echo "Operating System: $OSTYPE"
  
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    echo "✓ Windows environment detected"
  else
    echo "warn: Not running on Windows, some tests will be skipped"
  fi
  
  # Test common utilities
  local utilities=("curl" "unzip" "base64")
  for util in "${utilities[@]}"; do
    if command -v "$util" &> /dev/null; then
      echo "✓ $util is available"
    else
      echo "❌ $util is missing"
    fi
  done
}

function test_certificate_setup() {
  echo "3. Testing certificate setup..."
  
  if [[ -z "$SM_CLIENT_CERT_FILE_B64" ]]; then
    echo "warn: SM_CLIENT_CERT_FILE_B64 not set, skipping certificate test"
    return 0
  fi
  
  # Test base64 decoding
  local cert_path="/tmp/test_certificate.p12"
  if echo "$SM_CLIENT_CERT_FILE_B64" | base64 -d > "$cert_path" 2>/dev/null; then
    local cert_size=$(stat -c%s "$cert_path" 2>/dev/null || stat -f%z "$cert_path" 2>/dev/null || echo "unknown")
    echo "✓ Certificate decoded successfully ($cert_size bytes)"
    rm -f "$cert_path"
  else
    echo "❌ Failed to decode certificate from base64"
    return 1
  fi
}

function test_keylocker_tools() {
  echo "4. Testing DigiCert KeyLocker tools..."
  
  if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "win32" && "$OSTYPE" != "cygwin" ]]; then
    echo "warn: Not on Windows, skipping tool installation test"
    return 0
  fi
  
  # Test if smctl is already available
  if command -v smctl &> /dev/null; then
    echo "✓ smctl is already installed"
    
    # Test health check if environment is configured
    if [[ -n "$SM_HOST" && -n "$SM_API_KEY" ]]; then
      setup_digicer_keylocker
      if test_keylocker_connection; then
        echo "✓ DigiCert KeyLocker connection successful"
      else
        echo "❌ DigiCert KeyLocker connection failed"
        return 1
      fi
    else
      echo "warn: KeyLocker environment not configured, skipping connection test"
    fi
  else
    echo "warn: smctl not installed, would need to install during actual signing"
  fi
}

function main() {
  echo "Starting DigiCert KeyLocker test suite..."
  echo ""
  
  local test_functions=(
    "test_secrets"
    "test_environment" 
    "test_certificate_setup"
    "test_keylocker_tools"
  )
  
  local passed=0
  local total=${#test_functions[@]}
  
  for test_func in "${test_functions[@]}"; do
    echo ""
    if $test_func; then
      ((passed++))
    fi
  done
  
  echo ""
  echo "=== Test Results ==="
  echo "Passed: $passed/$total tests"
  
  if [[ $passed -eq $total ]]; then
    echo "✅ All tests passed! DigiCert KeyLocker setup looks good."
    exit 0
  else
    echo "⚠️  Some tests failed or were skipped. Check the output above."
    exit 1
  fi
}

# Run tests
main "$@"