# macOS Runner Deployment Guide

This guide provides step-by-step instructions for deploying the macOS runner infrastructure for Bun CI.

## Prerequisites

### 1. MacStadium Account Setup

1. **Create MacStadium Account**
   - Sign up at [MacStadium](https://www.macstadium.com/)
   - Purchase Orka plan with appropriate VM allocation

2. **Configure API Access**
   - Generate API key from MacStadium dashboard
   - Note down your Orka endpoint URL
   - Test API connectivity

3. **Base Image Preparation**
   - Ensure base macOS images are available in your account
   - Verify image naming convention: `base-images/macos-{version}-{name}`

### 2. AWS Account Setup

1. **Create AWS Account**
   - Set up AWS account for Terraform state storage
   - Create S3 bucket for Terraform backend: `bun-terraform-state`

2. **Configure IAM**
   - Create IAM user with appropriate permissions
   - Generate access key and secret key
   - Attach policies for S3, CloudWatch, and EC2 (if using AWS resources)

### 3. GitHub Repository Setup

1. **Fork or Clone Repository**
   - Ensure you have admin access to the repository
   - Create necessary branches for deployment

2. **Configure Repository Secrets**
   - Add all required secrets (see main README.md)
   - Test secret accessibility

### 4. Buildkite Setup

1. **Organization Configuration**
   - Create or access Buildkite organization
   - Generate agent token with appropriate permissions
   - Note organization slug

2. **Queue Configuration**
   - Create queues: `macos`, `macos-arm64`, `macos-x86_64`
   - Configure queue-specific settings

## Step-by-Step Deployment

### Step 1: Environment Preparation

1. **Install Required Tools**
   ```bash
   # Install Terraform
   wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip
   unzip terraform_1.6.0_linux_amd64.zip
   sudo mv terraform /usr/local/bin/
   
   # Install Packer
   wget https://releases.hashicorp.com/packer/1.9.4/packer_1.9.4_linux_amd64.zip
   unzip packer_1.9.4_linux_amd64.zip
   sudo mv packer /usr/local/bin/
   
   # Install AWS CLI
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   
   # Install MacStadium CLI
   curl -L "https://github.com/macstadium/orka-cli/releases/latest/download/orka-cli-linux-amd64.tar.gz" | tar -xz
   sudo mv orka-cli /usr/local/bin/orka
   ```

2. **Configure AWS Credentials**
   ```bash
   aws configure
   # Enter your AWS access key, secret key, and region
   ```

3. **Configure MacStadium CLI**
   ```bash
   orka config set endpoint <your-orka-endpoint>
   orka auth token <your-orka-token>
   ```

### Step 2: SSH Key Setup

1. **Generate SSH Key Pair**
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/bun-runner -N ""
   ```

2. **Copy Public Key to Terraform Directory**
   ```bash
   mkdir -p .buildkite/macos-runners/terraform/ssh-keys
   cp ~/.ssh/bun-runner.pub .buildkite/macos-runners/terraform/ssh-keys/bun-runner.pub
   ```

### Step 3: Terraform Backend Setup

1. **Create S3 Bucket for Terraform State**
   ```bash
   aws s3 mb s3://bun-terraform-state --region us-west-2
   aws s3api put-bucket-versioning --bucket bun-terraform-state --versioning-configuration Status=Enabled
   aws s3api put-bucket-encryption --bucket bun-terraform-state --server-side-encryption-configuration '{
     "Rules": [
       {
         "ApplyServerSideEncryptionByDefault": {
           "SSEAlgorithm": "AES256"
         }
       }
     ]
   }'
   ```

2. **Create Terraform Variables File**
   ```bash
   cd .buildkite/macos-runners/terraform
   cat > production.tfvars << EOF
   environment = "production"
   macstadium_api_key = "your-macstadium-api-key"
   buildkite_agent_token = "your-buildkite-agent-token"
   github_token = "your-github-token"
   fleet_size = {
     macos_13 = 4
     macos_14 = 6
     macos_15 = 8
   }
   vm_configuration = {
     cpu_count = 12
     memory_gb = 32
     disk_size = 500
   }
   EOF
   ```

### Step 4: Build VM Images

1. **Validate Packer Configuration**
   ```bash
   cd .buildkite/macos-runners/packer
   packer validate -var "macos_version=15" macos-base.pkr.hcl
   ```

2. **Build macOS 15 Image**
   ```bash
   packer build \
     -var "macos_version=15" \
     -var "orka_endpoint=<your-orka-endpoint>" \
     -var "orka_auth_token=<your-orka-token>" \
     macos-base.pkr.hcl
   ```

3. **Build macOS 14 Image**
   ```bash
   packer build \
     -var "macos_version=14" \
     -var "orka_endpoint=<your-orka-endpoint>" \
     -var "orka_auth_token=<your-orka-token>" \
     macos-base.pkr.hcl
   ```

4. **Build macOS 13 Image**
   ```bash
   packer build \
     -var "macos_version=13" \
     -var "orka_endpoint=<your-orka-endpoint>" \
     -var "orka_auth_token=<your-orka-token>" \
     macos-base.pkr.hcl
   ```

### Step 5: Deploy VM Fleet

1. **Initialize Terraform**
   ```bash
   cd .buildkite/macos-runners/terraform
   terraform init
   ```

2. **Create Production Workspace**
   ```bash
   terraform workspace new production
   ```

3. **Plan Deployment**
   ```bash
   terraform plan -var-file="production.tfvars"
   ```

4. **Apply Deployment**
   ```bash
   terraform apply -var-file="production.tfvars"
   ```

### Step 6: Verify Deployment

1. **Check VM Status**
   ```bash
   orka vm list
   ```

2. **Check Terraform Outputs**
   ```bash
   terraform output
   ```

3. **Test VM Connectivity**
   ```bash
   # Get VM IP from terraform output
   VM_IP=$(terraform output -json vm_instances | jq -r '.value | to_entries[0].value.ip_address')
   
   # Test SSH connectivity
   ssh -i ~/.ssh/bun-runner admin@$VM_IP
   
   # Test health endpoint
   curl http://$VM_IP:8080/health
   ```

4. **Verify Buildkite Agent Connectivity**
   ```bash
   curl -H "Authorization: Bearer <your-buildkite-api-token>" \
     "https://api.buildkite.com/v2/organizations/<your-org>/agents"
   ```

### Step 7: Configure GitHub Actions

1. **Enable GitHub Actions Workflows**
   - Navigate to repository Actions tab
   - Enable workflows if not already enabled

2. **Test Image Rebuild Workflow**
   ```bash
   # Trigger manual rebuild
   gh workflow run image-rebuild.yml
   ```

3. **Test Fleet Deployment Workflow**
   ```bash
   # Trigger manual deployment
   gh workflow run deploy-fleet.yml
   ```

## Post-Deployment Configuration

### 1. Monitoring Setup

1. **CloudWatch Dashboards**
   - Create custom dashboards for VM metrics
   - Set up alarms for critical thresholds

2. **Discord Notifications**
   - Configure Discord webhook for alerts
   - Test notification delivery

### 2. Backup Configuration

1. **Enable Automated Snapshots**
   ```bash
   # Update terraform configuration
   backup_config = {
     enable_snapshots = true
     snapshot_schedule = "0 4 * * *"
     snapshot_retention = 7
   }
   ```

2. **Test Backup Restoration**
   - Create test snapshot
   - Verify restoration process

### 3. Security Hardening

1. **Review Security Groups**
   - Minimize open ports
   - Restrict source IP ranges

2. **Enable Audit Logging**
   - Configure CloudTrail for AWS resources
   - Enable MacStadium audit logs

### 4. Performance Optimization

1. **Monitor Resource Usage**
   - Review CPU, memory, disk usage
   - Adjust VM sizes if needed

2. **Optimize Auto-Scaling**
   - Monitor scaling events
   - Adjust thresholds as needed

## Maintenance Procedures

### Daily Maintenance

1. **Automated Tasks**
   - Image rebuilds (automatic)
   - Health checks (automatic)
   - Cleanup processes (automatic)

2. **Manual Monitoring**
   - Check Discord notifications
   - Review CloudWatch metrics
   - Monitor Buildkite queue

### Weekly Maintenance

1. **Review Metrics**
   - Analyze performance trends
   - Check cost optimization opportunities

2. **Update Documentation**
   - Update configuration changes
   - Review troubleshooting guides

### Monthly Maintenance

1. **Capacity Planning**
   - Review usage patterns
   - Plan capacity adjustments

2. **Security Updates**
   - Review security patches
   - Update base images if needed

## Troubleshooting Common Issues

### Issue: VM Creation Fails

```bash
# Check MacStadium account limits
orka account info

# Check available resources
orka resource list

# Review Packer logs
tail -f packer-build.log
```

### Issue: Terraform Apply Fails

```bash
# Check Terraform state
terraform state list

# Refresh state
terraform refresh

# Check provider versions
terraform version
```

### Issue: Buildkite Agents Not Connecting

```bash
# Check agent configuration
cat /usr/local/var/buildkite-agent/buildkite-agent.cfg

# Check agent logs
tail -f /usr/local/var/log/buildkite-agent/buildkite-agent.log

# Restart agent service
sudo launchctl unload /Library/LaunchDaemons/com.buildkite.buildkite-agent.plist
sudo launchctl load /Library/LaunchDaemons/com.buildkite.buildkite-agent.plist
```

## Rollback Procedures

### Rollback VM Fleet

1. **Identify Previous Good State**
   ```bash
   terraform state list
   git log --oneline terraform/
   ```

2. **Rollback to Previous Configuration**
   ```bash
   git checkout <previous-commit>
   terraform plan -var-file="production.tfvars"
   terraform apply -var-file="production.tfvars"
   ```

### Rollback VM Images

1. **List Available Images**
   ```bash
   orka image list
   ```

2. **Update Terraform to Use Previous Images**
   ```bash
   # Edit terraform configuration to use previous image IDs
   terraform plan -var-file="production.tfvars"
   terraform apply -var-file="production.tfvars"
   ```

## Cost Optimization Tips

1. **Right-Size VMs**
   - Monitor actual resource usage
   - Adjust VM specifications accordingly

2. **Implement Scheduling**
   - Schedule VM shutdowns during low-usage periods
   - Use auto-scaling effectively

3. **Resource Cleanup**
   - Regularly clean up old images
   - Remove unused snapshots

4. **Monitor Costs**
   - Set up cost alerts
   - Review monthly usage reports

## Support

For additional support:
- Check the main README.md for troubleshooting
- Review GitHub Actions logs
- Contact MacStadium support for platform issues
- Open issues in the repository for infrastructure problems