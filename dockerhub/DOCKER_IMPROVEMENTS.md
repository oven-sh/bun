# Docker Image Improvements

This document outlines the comprehensive improvements made to Bun's Docker images to address security vulnerabilities, missing features, and outdated base images.

## Summary of Changes

### 1. Security Updates

#### Base Image Updates
- **Distroless**: Updated from `debian11` to `debian12` (bookworm) - Addresses CVE vulnerabilities reported in #22594
- **Alpine**: Updated from `3.20` to `3.21` - Latest stable Alpine release with security patches
- **Debian/Debian-slim**: Ensured using `bookworm` (Debian 12) consistently

#### Automated Security Workflow
- Added `.github/workflows/docker-security.yml` for:
  - Weekly automated base image updates
  - Vulnerability scanning with Trivy
  - Automatic PR creation for security updates
  - SARIF upload to GitHub Security tab

### 2. Feature Additions

#### Essential Packages
Added commonly requested packages to all non-distroless images:
- **git**: Addresses #4687 - Required for git-based npm dependencies
- **ca-certificates**: Ensures HTTPS connections work properly
- **python3** (debian only): For node-gyp compatibility

### 3. Build and Publishing Improvements

#### New Scripts
- **`test-all-images.sh`**: Comprehensive testing script that:
  - Builds all Docker variants
  - Tests bun/bunx commands
  - Verifies JavaScript execution
  - Checks package installation
  - Runs security scans
  
- **`publish-images.sh`**: Production-ready publishing script that:
  - Supports multi-architecture builds (amd64/arm64)
  - Handles semantic versioning tags
  - Provides dry-run capability
  - Manages all variant suffixes correctly

### 4. Issues Addressed

The following issues are resolved or improved by these changes:

- **#22594**: HIGH vulnerabilities in Debian images - Fixed by updating base images
- **#20414**: Distroless images outdated - Fixed by ensuring distroless is built in CI
- **#4687**: Missing git in Docker images - Fixed by adding git to all images
- **#3272**: CVEs in Docker images - Addressed via base image updates and security scanning
- **#17463**: Shell commands issues in distroless - Documented as expected behavior
- **#18325**: bunx not available in Alpine - Verified symlink creation

## Docker Image Variants

### 1. Debian (Full)
- Base: `debian:bookworm`
- Includes: git, curl, python3, ca-certificates
- Use case: Full compatibility, development environments

### 2. Debian Slim
- Base: `debian:bookworm-slim`
- Includes: git, ca-certificates
- Use case: Production with minimal overhead

### 3. Alpine
- Base: `alpine:3.21`
- Includes: git, ca-certificates, libgcc, libstdc++
- Use case: Smallest image size with package management

### 4. Distroless
- Base: `gcr.io/distroless/base-nossl-debian12`
- Includes: Only Bun binary
- Use case: Maximum security, minimal attack surface
- Note: No shell, no package manager - purely for running Bun applications

## Usage Examples

### Basic Usage
```dockerfile
# Development - full features
FROM oven/bun:latest

# Production - smaller size
FROM oven/bun:slim

# Minimal - smallest size with package manager
FROM oven/bun:alpine

# Maximum security - no shell
FROM oven/bun:distroless
```

### With Git Dependencies
```dockerfile
FROM oven/bun:slim
WORKDIR /app
COPY package.json bun.lockb ./
# Git is now available for git-based dependencies
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "start"]
```

### Multi-stage Build
```dockerfile
# Build stage
FROM oven/bun:latest AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Production stage - distroless for security
FROM oven/bun:distroless
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENTRYPOINT ["bun", "dist/server.js"]
```

## CI/CD Integration

### GitHub Actions
The release workflow now:
1. Builds all variants including distroless
2. Pushes to Docker Hub with proper tags
3. Runs security scans
4. Updates base images automatically

### Local Testing
```bash
# Test all images
cd dockerhub
./test-all-images.sh

# Test with specific version
./test-all-images.sh v1.2.22

# Build and publish (dry run)
./publish-images.sh

# Build and publish (actual push)
PUSH_IMAGES=true BUN_VERSION=v1.2.22 ./publish-images.sh
```

## Security Best Practices

1. **Use distroless for production** when possible - smallest attack surface
2. **Regular updates** - Automated weekly base image updates via GitHub Actions
3. **Vulnerability scanning** - Integrated Trivy scanning in CI
4. **Minimal packages** - Only essential packages included
5. **Non-root user** - All images run as `bun` user (UID 1000)

## Migration Guide

### From Old Images
If you're using older Bun Docker images:

1. **Update base image tags** in your Dockerfiles
2. **Remove git installation** steps - git is now included
3. **Check for CVE warnings** - New images address known vulnerabilities
4. **Test distroless** - Consider migrating to distroless for production

### Breaking Changes
- Distroless now uses Debian 12 instead of Debian 11
- Alpine updated to 3.21 (check for Alpine-specific compatibility)

## Future Improvements

Potential future enhancements:
- [ ] Add HEALTHCHECK instructions
- [ ] Create debug variants with additional tools
- [ ] Add Windows container support
- [ ] Implement image signing with cosign
- [ ] Add SBOM (Software Bill of Materials) generation

## Contributing

To contribute to Docker image improvements:
1. Test changes with `./test-all-images.sh`
2. Update this documentation
3. Ensure CI passes
4. Submit PR with clear description of changes

## Support

For Docker-related issues:
- File issues with the `docker` label
- Include Docker variant and version
- Provide minimal reproduction Dockerfile