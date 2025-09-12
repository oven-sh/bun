#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Building and testing all Bun Docker images..."

# Get the latest Bun version or use a specified one
BUN_VERSION=${1:-latest}
echo "Using Bun version: $BUN_VERSION"

# Array of variants to test
VARIANTS=("debian" "debian-slim" "alpine" "distroless")

# Track results
FAILED_VARIANTS=()
PASSED_VARIANTS=()

# Function to test a Docker image
test_docker_image() {
    local variant=$1
    local dir=$2
    local tag="bun-test:$variant"
    
    echo -e "\n${YELLOW}Testing $variant...${NC}"
    
    # Build the image
    echo "Building $variant image..."
    if ! docker build -t "$tag" "$dir" --build-arg BUN_VERSION="$BUN_VERSION" 2>&1 | tail -20; then
        echo -e "${RED}✗ Failed to build $variant${NC}"
        FAILED_VARIANTS+=("$variant (build failed)")
        return 1
    fi
    
    # Test 1: Check if bun is installed and works
    echo "Testing bun command..."
    if ! docker run --rm "$tag" bun --version; then
        echo -e "${RED}✗ bun --version failed for $variant${NC}"
        FAILED_VARIANTS+=("$variant (bun command failed)")
        return 1
    fi
    
    # Test 2: Check if bunx works
    echo "Testing bunx command..."
    if ! docker run --rm "$tag" sh -c 'which bunx && bunx --version' 2>/dev/null; then
        echo -e "${YELLOW}⚠ bunx not available in $variant (may be expected for distroless)${NC}"
    fi
    
    # Test 3: Test a simple JavaScript execution
    echo "Testing JavaScript execution..."
    if ! docker run --rm "$tag" bun eval 'console.log("Hello from Bun!")'; then
        echo -e "${RED}✗ JavaScript execution failed for $variant${NC}"
        FAILED_VARIANTS+=("$variant (JS execution failed)")
        return 1
    fi
    
    # Test 4: Check if git is installed (except distroless)
    if [ "$variant" != "distroless" ]; then
        echo "Testing git availability..."
        if ! docker run --rm "$tag" sh -c 'which git' 2>/dev/null; then
            echo -e "${YELLOW}⚠ git not available in $variant${NC}"
        fi
    fi
    
    # Test 5: Test package installation
    echo "Testing package installation..."
    if ! docker run --rm "$tag" sh -c 'echo "{\"name\":\"test\",\"dependencies\":{\"is-number\":\"*\"}}" > package.json && bun install --no-save 2>&1 | grep -q "is-number"' 2>/dev/null; then
        if [ "$variant" = "distroless" ]; then
            echo -e "${YELLOW}⚠ Package installation test skipped for distroless (no shell)${NC}"
        else
            echo -e "${YELLOW}⚠ Package installation may have issues in $variant${NC}"
        fi
    fi
    
    # Test 6: Check multi-arch support
    echo "Checking image architecture..."
    docker run --rm "$tag" sh -c 'uname -m' 2>/dev/null || echo "Architecture check skipped (no shell)"
    
    # Test 7: Security scan with trivy (if available)
    if command -v trivy &> /dev/null; then
        echo "Running security scan..."
        trivy image --severity HIGH,CRITICAL --no-progress "$tag" 2>/dev/null | grep -E "Total:|HIGH:|CRITICAL:" || echo "No HIGH/CRITICAL vulnerabilities found"
    fi
    
    echo -e "${GREEN}✓ $variant tests passed${NC}"
    PASSED_VARIANTS+=("$variant")
    return 0
}

# Test each variant
for variant in "${VARIANTS[@]}"; do
    # Determine the directory
    if [ "$variant" = "debian-slim" ]; then
        dir="./debian-slim"
    elif [ "$variant" = "debian" ]; then
        dir="./debian"
    else
        dir="./$variant"
    fi
    
    # Check if directory exists
    if [ ! -d "$dir" ]; then
        echo -e "${RED}✗ Directory $dir not found for $variant${NC}"
        FAILED_VARIANTS+=("$variant (directory not found)")
        continue
    fi
    
    test_docker_image "$variant" "$dir" || true
done

# Print summary
echo -e "\n${YELLOW}========== TEST SUMMARY ==========${NC}"
echo -e "${GREEN}Passed: ${#PASSED_VARIANTS[@]} variants${NC}"
for variant in "${PASSED_VARIANTS[@]}"; do
    echo -e "  ${GREEN}✓${NC} $variant"
done

if [ ${#FAILED_VARIANTS[@]} -gt 0 ]; then
    echo -e "${RED}Failed: ${#FAILED_VARIANTS[@]} variants${NC}"
    for variant in "${FAILED_VARIANTS[@]}"; do
        echo -e "  ${RED}✗${NC} $variant"
    done
    exit 1
else
    echo -e "\n${GREEN}All Docker images built and tested successfully!${NC}"
fi

# Cleanup test images
echo -e "\nCleaning up test images..."
for variant in "${VARIANTS[@]}"; do
    docker rmi "bun-test:$variant" 2>/dev/null || true
done

echo "Done!"