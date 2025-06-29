# Bun CI Documentation

## Overview

Bun uses **BuildKite** as its primary continuous integration (CI) system, with additional GitHub Actions workflows for specific tasks. The CI infrastructure is designed to build and test Bun across multiple platforms (macOS, Linux, Windows) and architectures (x64, aarch64) with various configurations.

## Key Components

### 1. BuildKite Pipeline (`.buildkite/`)

#### `bootstrap.yml`

The entry point for BuildKite CI runs. It:

- Requires manual approval for pull requests from forks (security measure)
- Executes the main CI script (`ci.mjs`) on a Darwin (macOS) build agent
- Must be manually updated in BuildKite settings when changed

#### `ci.mjs`

The main CI orchestration script that:

- Dynamically generates the BuildKite pipeline based on the build context
- Manages build and test jobs across different platforms
- Handles various build profiles (release, debug, assert, asan)
- Supports manual builds with customizable options
- Manages artifact uploads and benchmark submissions

### 2. Build System (`scripts/`)

#### `bootstrap.sh`

A universal bootstrap script that sets up build dependencies:

- **Version**: 11 (increment when dependencies change)
- Works on macOS and Linux with POSIX shell
- Installs system packages, development tools, and Bun-specific dependencies
- Configures ulimits for CI environments
- Sets up package managers (apt, dnf, yum, apk, brew)
- Handles Docker-specific configurations

#### `build.mjs`

The main build orchestration script that:

- Wraps CMake for building Bun
- Manages build caching for faster CI runs
- Handles parallel builds and error reporting
- Integrates with BuildKite for annotation reporting
- Supports cross-compilation via toolchains

#### `machine.mjs`

Virtual machine management script for CI that:

- Supports multiple cloud providers: AWS, Google Cloud, Docker, OrbStack, Tart
- Provisions ephemeral build environments
- Manages SSH connections to build machines
- Handles machine lifecycle (create, connect, destroy)

## Build Platforms

### Supported Configurations

**Build Platforms:**

- macOS (Darwin): aarch64, x64
- Linux: aarch64, x64 (with musl and glibc variants)
- Windows: x64
- Special builds: baseline (for older CPUs), ASAN (AddressSanitizer)

**Test Platforms:**

- macOS: 13, 14 (latest and previous versions)
- Linux distributions:
  - Debian 12
  - Ubuntu 20.04 (oldest), 24.04 (latest)
  - Alpine 3.21 (musl)
  - Amazon Linux 2023
- Windows: Server 2019

## Build Process

### Four-Stage Build Pipeline

1. **Dependencies** (`build-vendor`)
   - Cached across builds
   - Depends on git submodule hashes
   - Built using `scripts/all-dependencies.sh`

2. **Zig Compilation** (`build-zig`)
   - Compiles all `.zig` files
   - Cross-compilable without dependencies
   - Produces `bun-zig.o`
   - Uses dedicated Zig build agents for efficiency

3. **C++ Compilation** (`build-cpp`)
   - Compiles all `.cpp` files
   - Depends on JavaScriptCore headers
   - Produces `bun-cpp-objects.a`
   - Can download WebKit from GitHub releases if not present

4. **Linking** (`build-bun`)
   - Links all objects together
   - Produces final `bun` executable
   - Generates debug symbols and profile builds

### Parallel Execution

The CI system maximizes parallelism by:

- Running Zig and C++ compilation on separate machines
- Using different instance types optimized for each task
- Caching dependencies between builds
- Running tests in parallel (up to 10 workers on Linux)

## CI Agents

### AWS EC2 Configuration

**Build Agents:**

- C++ builds: `c7i.16xlarge` (x64) or `c8g.16xlarge` (aarch64)
  - 32 CPUs with single thread per core for deterministic builds
- Zig builds: `r8g.large` (memory-optimized for Zig compiler)

**Test Agents:**

- Standard: `c7i.xlarge` (x64) or `c8g.xlarge` (aarch64)
- Windows: `c7i.2xlarge` (extra memory for certain tests)

**Image Management:**

- Base images are versioned using bootstrap script version
- Images can be rebuilt with `build-images` option
- Published to AWS for reuse across builds

### macOS Agents

- Uses on-premise Mac hardware for builds and tests
- Managed via `build-darwin` and `test-darwin` queues
- Supports both x64 and aarch64 architectures

## Build Options

### Manual Build Configuration

When triggering manual builds, the following options are available:

- **Canary Build**: Whether to build a canary release
- **Skip Builds**: Download artifacts from last successful build
- **Skip Tests**: Only run builds, skip test execution
- **Force Builds/Tests**: Run even if no relevant files changed
- **Build Profiles**: release, assert, asan, debug
- **Build Platforms**: Select specific platforms to build
- **Test Platforms**: Select specific platforms to test
- **Test Files**: Run specific test files or directories
- **Build/Publish Images**: Rebuild base Docker/AMI images
- **Unified Builds/Tests**: Run in single step (slower but simpler)

### Commit Message Triggers

Special commit message patterns trigger CI behaviors:

- `[skip ci]` or `[no ci]`: Skip all CI
- `[skip builds]` or `[only tests]`: Skip build phase
- `[skip tests]` or `[only builds]`: Skip test phase
- `[force builds]`: Force builds even if no changes
- `[build images]`: Rebuild base images
- `[publish images]`: Rebuild and publish base images
- `[release]`: Build for release (disables canary)

## Release Process

### Canary Releases

- Automatically built from main branch
- Versioned with canary revision number
- Uploaded to GitHub releases as pre-release

### Production Releases

- Triggered from main branch only
- Requires `[release]` in commit message or manual trigger
- Uploads to multiple destinations:
  - GitHub releases
  - npm registry
  - Docker Hub
  - Homebrew
  - S3 buckets

### Release Script (`upload-release.sh`)

- Validates release conditions (main branch, main repo)
- Handles authentication with external services
- Manages artifact naming and versioning
- Uploads build artifacts and metadata

## Caching Strategy

### Build Cache

- Stored in `.buildkite/cache/{repo}/{branch}/{step}`
- Read from main branch cache if current branch cache missing
- Three strategies: read-only, write-only, read-write
- Automatically cleaned on `BUILDKITE_CLEAN_CHECKOUT`

### Dependency Cache

- WebKit and other dependencies cached separately
- Downloaded from GitHub releases when possible
- Version-locked to git submodule commits

## Testing Infrastructure

### Test Runner (`runner.node.mjs`)

- Downloads build artifacts from BuildKite
- Distributes tests across parallel workers
- Handles platform-specific test configurations
- Reports results back to BuildKite

### Test Parallelism

- macOS: 2 parallel workers
- Linux: 10 parallel workers
- Windows: No parallelism (reliability)
- ASAN builds: Extended timeout (45 minutes)

## Security Considerations

1. **Fork PR Protection**: Manual approval required
2. **Secrets Management**:
   - AWS credentials for EC2
   - GitHub tokens for releases
   - npm tokens for publishing
   - Docker Hub credentials
3. **Network Isolation**: Build machines in isolated VPCs
4. **Artifact Signing**: Release artifacts are signed

## Monitoring and Debugging

### Build Artifacts

All builds upload:

- Compiled binaries
- Debug symbols
- Build logs
- Test results
- Pipeline configuration (`ci.yml`)

### Benchmark Tracking

- Performance benchmarks run on every main branch build
- Results uploaded to tracking service
- Used to detect performance regressions

### Debug Helpers

- `BUN_DEBUG_*` environment variables for detailed logging
- `CMAKE_VERBOSE_MAKEFILE` for build debugging
- BuildKite annotations for error reporting
- Transpiled source available in `/tmp/bun-debug-src/`

## Best Practices

1. **Incremental Changes**: Use build cache for faster iteration
2. **Platform Testing**: Test on oldest and newest supported versions
3. **Resource Management**: Choose appropriate instance types
4. **Error Handling**: Use BuildKite annotations for clear error reporting
5. **Security**: Never commit secrets, use BuildKite secrets management

## Troubleshooting

### Common Issues

1. **Cache Corruption**: Set `BUILDKITE_CLEAN_CHECKOUT=true`
2. **Dependency Failures**: Increment bootstrap version
3. **Flaky Tests**: Use retry mechanisms or investigate root cause
4. **Resource Limits**: Check ulimits and instance specifications

### Getting Help

- Check BuildKite build logs for detailed error messages
- Review recent changes to CI configuration files
- Consult team members familiar with CI infrastructure
- File issues for persistent CI problems

## Future Improvements

- Migrate GitHub Actions release workflow to BuildKite
- Optimize build times with better caching strategies
- Add more granular test categorization
- Improve cross-compilation support
- Enhanced benchmark tracking and visualization
