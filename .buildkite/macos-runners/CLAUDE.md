# macOS Runner Infrastructure - Claude Development Guide

This document provides context and guidance for Claude to work on the macOS runner infrastructure.

## Overview

This infrastructure provides automated, scalable macOS CI runners for Bun using MacStadium's Orka platform. It implements complete job isolation, daily image rebuilds, and comprehensive testing.

## Architecture

### Core Components
- **Packer**: Builds VM images with all required software
- **Terraform**: Manages VM fleet with auto-scaling
- **GitHub Actions**: Automates daily rebuilds and deployments
- **User Management**: Creates isolated users per job (`bk-<job-id>`)

### Key Features
- **Complete Job Isolation**: Each Buildkite job runs in its own user account
- **Daily Image Rebuilds**: Automated nightly rebuilds ensure fresh environments
- **Flakiness Testing**: Multiple test iterations ensure reliability (80% success rate minimum)
- **Software Validation**: All tools tested for proper installation and functionality
- **Version Synchronization**: Exact versions match bootstrap.sh requirements

## File Structure

```
.buildkite/macos-runners/
├── packer/
│   └── macos-base.pkr.hcl          # VM image building configuration
├── terraform/
│   ├── main.tf                     # Infrastructure definition
│   ├── variables.tf                # Configuration variables
│   ├── outputs.tf                  # Resource outputs
│   └── user-data.sh                # VM initialization script
├── scripts/
│   ├── bootstrap-macos.sh          # macOS software installation
│   ├── create-build-user.sh        # User creation for job isolation
│   ├── cleanup-build-user.sh       # User cleanup after jobs
│   └── job-runner.sh               # Main job lifecycle management
├── github-actions/
│   ├── image-rebuild.yml           # Daily image rebuild workflow
│   └── deploy-fleet.yml            # Fleet deployment workflow
├── README.md                       # User documentation
├── DEPLOYMENT.md                   # Deployment guide
└── CLAUDE.md                       # This file
```

## Software Versions (Must Match bootstrap.sh)

These versions are synchronized with `/scripts/bootstrap.sh`:

- **Node.js**: 24.3.0 (exact)
- **Bun**: 1.2.17 (exact)
- **LLVM**: 19.1.7 (exact)
- **CMake**: 3.30.5 (exact)
- **Buildkite Agent**: 3.87.0

## Key Scripts

### bootstrap-macos.sh
- Installs all required software with exact versions
- Configures development environment
- Sets up Tailscale, Docker, and other dependencies
- **Critical**: Must stay synchronized with main bootstrap.sh

### create-build-user.sh
- Creates unique user per job: `bk-<job-id>`
- Sets up isolated environment with proper permissions
- Configures shell environment and paths
- Creates workspace directories

### cleanup-build-user.sh
- Kills all processes owned by build user
- Removes user account and home directory
- Cleans up temporary files and caches
- Ensures complete isolation between jobs

### job-runner.sh
- Main orchestration script
- Manages job lifecycle: create user → run job → cleanup
- Handles timeouts and health checks
- Runs as root via LaunchDaemon

## GitHub Actions Workflows

### image-rebuild.yml
- Runs daily at 2 AM UTC
- Detects changes to trigger rebuilds
- Builds images for macOS 13, 14, 15
- **Validation Steps**:
  - Software installation verification
  - Flakiness testing (3 iterations, 80% success rate)
  - Health endpoint testing
- Discord notifications for status

### deploy-fleet.yml
- Manual deployment trigger
- Validates inputs and plans changes
- Deploys VM fleet with health checks
- Supports different environments (prod/staging/dev)

## Required Secrets

### MacStadium
- `MACSTADIUM_API_KEY`: API access key
- `ORKA_ENDPOINT`: Orka API endpoint
- `ORKA_AUTH_TOKEN`: Authentication token

### AWS
- `AWS_ACCESS_KEY_ID`: For Terraform state storage
- `AWS_SECRET_ACCESS_KEY`: For Terraform state storage

### Buildkite
- `BUILDKITE_AGENT_TOKEN`: Agent registration token
- `BUILDKITE_API_TOKEN`: For monitoring/status checks
- `BUILDKITE_ORG`: Organization slug

### GitHub
- `GITHUB_TOKEN`: For private repository access

### Notifications
- `DISCORD_WEBHOOK_URL`: For status notifications

## Development Guidelines

### Adding New Software
1. Update `bootstrap-macos.sh` with installation commands
2. Add version verification in the script
3. Include in validation tests in `image-rebuild.yml`
4. Update documentation in README.md

### Modifying User Isolation
1. Update `create-build-user.sh` for user creation
2. Update `cleanup-build-user.sh` for cleanup
3. Test isolation in `job-runner.sh`
4. Ensure proper permissions and security

### Updating VM Configuration
1. Modify `terraform/variables.tf` for fleet sizing
2. Update `terraform/main.tf` for infrastructure changes
3. Test deployment with `deploy-fleet.yml`
4. Update documentation

### Version Updates
1. **Critical**: Check `/scripts/bootstrap.sh` for version changes
2. Update exact versions in `bootstrap-macos.sh`
3. Update version verification in workflows
4. Update documentation

## Testing Strategy

### Image Validation
- Software installation verification
- Version checking for exact matches
- Health endpoint testing
- Basic functionality tests

### Flakiness Testing
- 3 test iterations per image
- 80% success rate minimum
- Tests basic commands, Node.js, Bun, build tools
- Automated cleanup of test VMs

### Integration Testing
- End-to-end job execution
- User isolation verification
- Resource cleanup validation
- Performance monitoring

## Troubleshooting

### Common Issues
1. **Version Mismatches**: Check bootstrap.sh for updates
2. **User Cleanup Failures**: Check process termination and file permissions
3. **Image Build Failures**: Check Packer logs and VM resources
4. **Flakiness**: Investigate VM performance and network issues

### Debugging Commands
```bash
# Check VM status
orka vm list

# Check image status
orka image list

# Test user creation
sudo /usr/local/bin/bun-ci/create-build-user.sh

# Check health endpoint
curl http://localhost:8080/health

# View logs
tail -f /usr/local/var/log/buildkite-agent/buildkite-agent.log
```

## Performance Considerations

### Resource Management
- VMs configured with 12 CPU cores, 32GB RAM
- Auto-scaling based on queue demand
- Aggressive cleanup to prevent resource leaks

### Cost Optimization
- Automated cleanup of old images and snapshots
- Efficient VM sizing based on workload requirements
- Scheduled maintenance windows

## Security

### Isolation
- Complete process isolation per job
- Separate user accounts with unique UIDs
- Cleanup of all user data after jobs

### Network Security
- VPC isolation with security groups
- Limited SSH access for debugging
- Encrypted communications

### Credential Management
- Secure secret storage in GitHub
- No hardcoded credentials in code
- Regular rotation of access tokens

## Monitoring

### Health Checks
- HTTP endpoints on port 8080
- Buildkite agent connectivity monitoring
- Resource usage tracking

### Alerts
- Discord notifications for failures
- Build status reporting
- Fleet deployment notifications

## Next Steps for Development

1. **Monitor bootstrap.sh**: Watch for version updates that need synchronization
2. **Performance Optimization**: Monitor resource usage and optimize VM sizes
3. **Enhanced Testing**: Add more comprehensive validation tests
4. **Cost Monitoring**: Track usage and optimize for cost efficiency
5. **Security Hardening**: Regular security reviews and updates

## References

- [MacStadium Orka Documentation](https://orkadocs.macstadium.com/)
- [Packer Documentation](https://www.packer.io/docs)
- [Terraform Documentation](https://www.terraform.io/docs)
- [Buildkite Agent Documentation](https://buildkite.com/docs/agent/v3)
- [Main bootstrap.sh](../../scripts/bootstrap.sh) - **Keep synchronized!**

---

**Important**: This infrastructure is critical for Bun's CI/CD pipeline. Always test changes thoroughly and maintain backward compatibility. The `bootstrap-macos.sh` script must stay synchronized with the main `bootstrap.sh` script to ensure consistent environments.