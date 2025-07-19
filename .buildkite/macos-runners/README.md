# macOS Runner Infrastructure

This directory contains the infrastructure-as-code for deploying and managing macOS CI runners for the Bun project. It is located in the `.buildkite` folder alongside other CI configuration. The infrastructure provides automated, scalable, and reliable macOS build environments using MacStadium's Orka platform.

## Architecture Overview

The infrastructure consists of several key components:

1. **VM Images**: Golden images built with Packer containing all necessary software
2. **VM Fleet**: Terraform-managed fleet of macOS VMs across different versions
3. **User Isolation**: Per-job user creation and cleanup for complete isolation
4. **Automation**: GitHub Actions workflows for daily image rebuilds and fleet management

## Key Features

- **Complete Isolation**: Each Buildkite job runs in its own user account
- **Automatic Cleanup**: Processes and temporary files are cleaned up after each job
- **Daily Image Rebuilds**: Automated nightly rebuilds ensure fresh, up-to-date environments
- **Multi-Version Support**: Supports macOS 13, 14, and 15 simultaneously
- **Auto-Scaling**: Automatic scaling based on job queue demand
- **Health Monitoring**: Continuous health checks and monitoring
- **Cost Optimization**: Efficient resource utilization and cleanup

## Directory Structure

```
.buildkite/macos-runners/
├── packer/                 # Packer configuration for VM images
│   ├── macos-base.pkr.hcl  # Main Packer configuration
│   └── ssh-keys/           # SSH keys for VM access
├── terraform/              # Terraform configuration for VM fleet
│   ├── main.tf            # Main Terraform configuration
│   ├── variables.tf       # Variable definitions
│   ├── outputs.tf         # Output definitions
│   └── user-data.sh       # VM initialization script
├── scripts/               # Management and utility scripts
│   ├── bootstrap-macos.sh # macOS-specific bootstrap script
│   ├── create-build-user.sh # User creation script
│   ├── cleanup-build-user.sh # User cleanup script
│   └── job-runner.sh      # Main job runner script
├── github-actions/        # GitHub Actions workflows
│   ├── image-rebuild.yml  # Daily image rebuild workflow
│   └── deploy-fleet.yml   # Fleet deployment workflow
└── README.md             # This file
```

## Prerequisites

Before deploying the infrastructure, ensure you have:

1. **MacStadium Account**: Active MacStadium Orka account with API access
2. **AWS Account**: For Terraform state storage and CloudWatch monitoring
3. **GitHub Repository**: With required secrets configured
4. **Buildkite Account**: With organization and agent tokens
5. **Required Tools**: Packer, Terraform, AWS CLI, and MacStadium CLI

## Required Secrets

Configure the following secrets in your GitHub repository:

### MacStadium
- `MACSTADIUM_API_KEY`: MacStadium API key
- `ORKA_ENDPOINT`: MacStadium Orka API endpoint
- `ORKA_AUTH_TOKEN`: MacStadium authentication token

### AWS
- `AWS_ACCESS_KEY_ID`: AWS access key ID
- `AWS_SECRET_ACCESS_KEY`: AWS secret access key

### Buildkite
- `BUILDKITE_AGENT_TOKEN`: Buildkite agent token
- `BUILDKITE_API_TOKEN`: Buildkite API token (for monitoring)
- `BUILDKITE_ORG`: Buildkite organization slug

### GitHub
- `GITHUB_TOKEN`: GitHub personal access token (for private repositories)

### Notifications
- `DISCORD_WEBHOOK_URL`: Discord webhook URL for notifications

## Quick Start

### 1. Deploy the Infrastructure

```bash
# Navigate to the terraform directory
cd .buildkite/macos-runners/terraform

# Initialize Terraform
terraform init

# Create or select workspace
terraform workspace new production

# Plan the deployment
terraform plan -var-file="production.tfvars"

# Apply the deployment
terraform apply -var-file="production.tfvars"
```

### 2. Build VM Images

```bash
# Navigate to the packer directory
cd .buildkite/macos-runners/packer

# Build macOS 15 image
packer build -var "macos_version=15" macos-base.pkr.hcl

# Build macOS 14 image
packer build -var "macos_version=14" macos-base.pkr.hcl

# Build macOS 13 image
packer build -var "macos_version=13" macos-base.pkr.hcl
```

### 3. Enable Automation

The GitHub Actions workflows will automatically:
- Rebuild images daily at 2 AM UTC
- Deploy fleet changes when configuration is updated
- Clean up old images and snapshots
- Monitor VM health and connectivity

## Configuration

### Fleet Size Configuration

Modify fleet sizes in `terraform/variables.tf`:

```hcl
variable "fleet_size" {
  default = {
    macos_13 = 4  # Number of macOS 13 VMs
    macos_14 = 6  # Number of macOS 14 VMs
    macos_15 = 8  # Number of macOS 15 VMs
  }
}
```

### VM Configuration

Adjust VM specifications in `terraform/variables.tf`:

```hcl
variable "vm_configuration" {
  default = {
    cpu_count = 12  # Number of CPU cores
    memory_gb = 32  # Memory in GB
    disk_size = 500 # Disk size in GB
  }
}
```

### Auto-Scaling Configuration

Configure auto-scaling parameters:

```hcl
variable "autoscaling_config" {
  default = {
    min_size                = 2
    max_size                = 30
    desired_capacity        = 10
    scale_up_threshold      = 80
    scale_down_threshold    = 20
    scale_up_adjustment     = 2
    scale_down_adjustment   = 1
    cooldown_period         = 300
  }
}
```

## Software Included

Each VM image includes:

### Development Tools
- Xcode Command Line Tools
- LLVM/Clang 19.1.7 (exact version)
- CMake 3.30.5 (exact version)
- Ninja build system
- pkg-config
- ccache

### Programming Languages
- Node.js 24.3.0 (exact version, matches bootstrap.sh)
- Bun 1.2.17 (exact version, matches bootstrap.sh)
- Python 3.11 and 3.12
- Go (latest)
- Rust (latest stable)

### Package Managers
- Homebrew
- npm
- yarn
- pip
- cargo

### Build Tools
- make
- autotools
- meson
- libtool

### Version Control
- Git
- GitHub CLI

### Utilities
- curl
- wget
- jq
- tree
- htop
- tmux
- screen

### Development Dependencies
- Docker Desktop
- Tailscale (for VPN connectivity)
- Age (for encryption)
- macFUSE (for filesystem testing)
- Chromium (for browser testing)
- Various system libraries and headers

### Quality Assurance
- **Flakiness Testing**: Each image undergoes multiple test iterations to ensure reliability
- **Software Validation**: All tools are tested for proper installation and functionality
- **Version Verification**: Exact version matching ensures consistency with bootstrap.sh

## User Isolation

Each Buildkite job runs in complete isolation:

1. **Unique User**: Each job gets a unique user account (`bk-<job-id>`)
2. **Isolated Environment**: Separate home directory and environment variables
3. **Process Isolation**: All processes are killed after job completion
4. **File System Cleanup**: Temporary files and caches are cleaned up
5. **Network Isolation**: No shared network resources between jobs

## Monitoring and Alerting

The infrastructure includes comprehensive monitoring:

- **Health Checks**: HTTP health endpoints on each VM
- **CloudWatch Metrics**: CPU, memory, disk usage monitoring
- **Buildkite Integration**: Agent connectivity monitoring
- **Slack Notifications**: Success/failure notifications
- **Log Aggregation**: Centralized logging for troubleshooting

## Security Considerations

- **Encrypted Disks**: All VM disks are encrypted
- **Network Security**: Security groups restrict network access
- **SSH Key Management**: Secure SSH key distribution
- **Regular Updates**: Automatic security updates
- **Process Isolation**: Complete isolation between jobs
- **Secure Credential Handling**: Secrets are managed securely

## Troubleshooting

### Common Issues

1. **VM Not Responding to Health Checks**
   ```bash
   # Check VM status
   orka vm list
   
   # Check VM logs
   orka vm logs <vm-name>
   
   # Restart VM
   orka vm restart <vm-name>
   ```

2. **Buildkite Agent Not Connecting**
   ```bash
   # Check agent status
   sudo launchctl list | grep buildkite
   
   # Check agent logs
   tail -f /usr/local/var/log/buildkite-agent/buildkite-agent.log
   
   # Restart agent
   sudo launchctl unload /Library/LaunchDaemons/com.buildkite.buildkite-agent.plist
   sudo launchctl load /Library/LaunchDaemons/com.buildkite.buildkite-agent.plist
   ```

3. **User Creation Failures**
   ```bash
   # Check user creation logs
   tail -f /var/log/system.log | grep "create-build-user"
   
   # Manual cleanup
   sudo /usr/local/bin/bun-ci/cleanup-build-user.sh <username>
   ```

4. **Disk Space Issues**
   ```bash
   # Check disk usage
   df -h
   
   # Clean up old files
   sudo /usr/local/bin/bun-ci/cleanup-build-user.sh --cleanup-all
   ```

### Debugging Commands

```bash
# Check system status
sudo /usr/local/bin/bun-ci/job-runner.sh health

# View active processes
ps aux | grep buildkite

# Check network connectivity
curl -v http://localhost:8080/health

# View system logs
tail -f /var/log/system.log

# Check Docker status
docker info
```

## Maintenance

### Regular Tasks

1. **Image Updates**: Images are rebuilt daily automatically
2. **Fleet Updates**: Terraform changes are applied automatically
3. **Cleanup**: Old images and snapshots are cleaned up automatically
4. **Monitoring**: Health checks run continuously

### Manual Maintenance

```bash
# Force image rebuild
gh workflow run image-rebuild.yml -f force_rebuild=true

# Scale fleet manually
gh workflow run deploy-fleet.yml -f fleet_size_macos_15=10

# Clean up old resources
cd terraform
terraform apply -refresh-only
```

## Cost Optimization

- **Right-Sizing**: VMs are sized appropriately for Bun workloads
- **Auto-Scaling**: Automatic scaling prevents over-provisioning
- **Resource Cleanup**: Aggressive cleanup prevents resource waste
- **Scheduled Shutdowns**: VMs can be scheduled for shutdown during low-usage periods

## Support and Contributing

For issues or questions:
1. Check the troubleshooting section above
2. Review GitHub Actions workflow logs
3. Check MacStadium Orka console
4. Open an issue in the repository

When contributing:
1. Test changes in a staging environment first
2. Update documentation as needed
3. Follow the existing code style
4. Add appropriate tests and validation

## License

This infrastructure code is part of the Bun project and follows the same license terms.