#!/bin/bash
set -e

# This script publishes Bun Docker images to Docker Hub
# It should be run from CI/CD or manually with proper credentials

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOCKER_REPO="oven/bun"
BUN_VERSION=${BUN_VERSION:-latest}
PUSH_IMAGES=${PUSH_IMAGES:-false}
PLATFORMS="linux/amd64,linux/arm64"

echo -e "${BLUE}Bun Docker Image Publisher${NC}"
echo "================================"
echo "Version: $BUN_VERSION"
echo "Repository: $DOCKER_REPO"
echo "Push enabled: $PUSH_IMAGES"
echo "Platforms: $PLATFORMS"
echo ""

# Check if docker buildx is available
if ! docker buildx version &> /dev/null; then
    echo -e "${RED}Error: Docker buildx is required but not found${NC}"
    echo "Please install Docker buildx: https://docs.docker.com/buildx/working-with-buildx/"
    exit 1
fi

# Setup buildx builder
BUILDER_NAME="bun-multiarch-builder"
if ! docker buildx ls | grep -q "$BUILDER_NAME"; then
    echo "Creating buildx builder..."
    docker buildx create --name "$BUILDER_NAME" --platform "$PLATFORMS" --use
else
    echo "Using existing buildx builder..."
    docker buildx use "$BUILDER_NAME"
fi

# Ensure builder is running
docker buildx inspect --bootstrap

# Function to build and optionally push an image
build_and_push() {
    local variant=$1
    local dir=$2
    local tags=$3
    
    echo -e "\n${YELLOW}Building $variant...${NC}"
    echo "Directory: $dir"
    echo "Tags: $tags"
    
    # Prepare build arguments
    local build_args="--platform $PLATFORMS"
    build_args="$build_args --build-arg BUN_VERSION=$BUN_VERSION"
    
    # Add tags
    for tag in $tags; do
        build_args="$build_args --tag $DOCKER_REPO:$tag"
    done
    
    # Add push flag if enabled
    if [ "$PUSH_IMAGES" = "true" ]; then
        build_args="$build_args --push"
    else
        build_args="$build_args --load"
    fi
    
    # Build the image
    echo "Running: docker buildx build $build_args $dir"
    if docker buildx build $build_args "$dir"; then
        echo -e "${GREEN}✓ Successfully built $variant${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to build $variant${NC}"
        return 1
    fi
}

# Determine version tags
determine_tags() {
    local variant=$1
    local suffix=$2
    local tags=""
    
    case "$BUN_VERSION" in
        latest)
            # For latest, we tag with 'latest' and the variant name
            if [ -z "$suffix" ]; then
                tags="latest"
            else
                tags="latest$suffix"
            fi
            # Also tag with just the variant name for convenience
            tags="$tags $variant"
            ;;
        canary)
            tags="canary$suffix"
            if [ "$variant" != "debian" ]; then
                tags="$tags canary-$variant"
            fi
            ;;
        v*.*.*)
            # Semantic version
            local version=${BUN_VERSION#v}
            local major=$(echo "$version" | cut -d. -f1)
            local minor=$(echo "$version" | cut -d. -f2)
            
            # Add full version tag
            tags="$version$suffix"
            
            # Add major.minor tag
            tags="$tags $major.$minor$suffix"
            
            # Add major tag
            tags="$tags $major$suffix"
            
            # For non-debian variants, also add variant-specific tags
            if [ "$variant" != "debian" ]; then
                tags="$tags $version-$variant"
            fi
            ;;
        *)
            # Custom tag
            tags="${BUN_VERSION}$suffix"
            ;;
    esac
    
    echo "$tags"
}

# Build configurations
declare -A VARIANTS=(
    ["debian"]=""
    ["debian-slim"]="-slim"
    ["alpine"]="-alpine"
    ["distroless"]="-distroless"
)

# Track results
FAILED_BUILDS=()
SUCCESSFUL_BUILDS=()

# Build each variant
for variant in "${!VARIANTS[@]}"; do
    suffix="${VARIANTS[$variant]}"
    
    # Determine directory
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
        FAILED_BUILDS+=("$variant")
        continue
    fi
    
    # Determine tags for this variant
    tags=$(determine_tags "$variant" "$suffix")
    
    # Build and optionally push
    if build_and_push "$variant" "$dir" "$tags"; then
        SUCCESSFUL_BUILDS+=("$variant")
    else
        FAILED_BUILDS+=("$variant")
    fi
done

# Print summary
echo -e "\n${YELLOW}========== BUILD SUMMARY ==========${NC}"
echo -e "${GREEN}Successful: ${#SUCCESSFUL_BUILDS[@]} variants${NC}"
for variant in "${SUCCESSFUL_BUILDS[@]}"; do
    echo -e "  ${GREEN}✓${NC} $variant"
done

if [ ${#FAILED_BUILDS[@]} -gt 0 ]; then
    echo -e "${RED}Failed: ${#FAILED_BUILDS[@]} variants${NC}"
    for variant in "${FAILED_BUILDS[@]}"; do
        echo -e "  ${RED}✗${NC} $variant"
    done
    exit 1
fi

# If pushing was enabled, show the published tags
if [ "$PUSH_IMAGES" = "true" ]; then
    echo -e "\n${GREEN}Images successfully published to $DOCKER_REPO${NC}"
    echo "You can pull them with:"
    for variant in "${!VARIANTS[@]}"; do
        suffix="${VARIANTS[$variant]}"
        tags=$(determine_tags "$variant" "$suffix")
        for tag in $tags; do
            echo "  docker pull $DOCKER_REPO:$tag"
        done
    done
else
    echo -e "\n${YELLOW}Images built locally (not pushed)${NC}"
    echo "To push images, set PUSH_IMAGES=true"
fi

echo -e "\n${GREEN}Done!${NC}"