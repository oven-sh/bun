# Core infrastructure variables
variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "bun-ci"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "region" {
  description = "MacStadium region"
  type        = string
  default     = "us-west-1"
}

# MacStadium configuration
variable "macstadium_api_key" {
  description = "MacStadium API key"
  type        = string
  sensitive   = true
}

variable "macstadium_endpoint" {
  description = "MacStadium API endpoint"
  type        = string
  default     = "https://api.macstadium.com"
}

# Buildkite configuration
variable "buildkite_agent_token" {
  description = "Buildkite agent token"
  type        = string
  sensitive   = true
}

variable "buildkite_org" {
  description = "Buildkite organization slug"
  type        = string
  default     = "bun"
}

variable "buildkite_queues" {
  description = "Buildkite queues to register agents with"
  type        = list(string)
  default     = ["macos", "macos-arm64", "macos-x86_64"]
}

# GitHub configuration
variable "github_token" {
  description = "GitHub token for accessing private repositories"
  type        = string
  sensitive   = true
}

variable "github_org" {
  description = "GitHub organization"
  type        = string
  default     = "oven-sh"
}

# VM fleet configuration
variable "fleet_size" {
  description = "Number of VMs per macOS version"
  type = object({
    macos_13 = number
    macos_14 = number
    macos_15 = number
  })
  default = {
    macos_13 = 4
    macos_14 = 6
    macos_15 = 8
  }
  
  validation {
    condition = alltrue([
      var.fleet_size.macos_13 >= 0,
      var.fleet_size.macos_14 >= 0,
      var.fleet_size.macos_15 >= 0,
      var.fleet_size.macos_13 + var.fleet_size.macos_14 + var.fleet_size.macos_15 > 0
    ])
    error_message = "Fleet sizes must be non-negative and at least one version must have VMs."
  }
}

variable "vm_configuration" {
  description = "VM configuration settings"
  type = object({
    cpu_count = number
    memory_gb = number
    disk_size = number
  })
  default = {
    cpu_count = 12
    memory_gb = 32
    disk_size = 500
  }
  
  validation {
    condition = alltrue([
      var.vm_configuration.cpu_count >= 4,
      var.vm_configuration.memory_gb >= 16,
      var.vm_configuration.disk_size >= 100
    ])
    error_message = "VM configuration must have at least 4 CPUs, 16GB memory, and 100GB disk."
  }
}

# Auto-scaling configuration
variable "autoscaling_enabled" {
  description = "Enable auto-scaling for VM fleet"
  type        = bool
  default     = true
}

variable "autoscaling_config" {
  description = "Auto-scaling configuration"
  type = object({
    min_size                = number
    max_size                = number
    desired_capacity        = number
    scale_up_threshold      = number
    scale_down_threshold    = number
    scale_up_adjustment     = number
    scale_down_adjustment   = number
    cooldown_period         = number
  })
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

# Image configuration
variable "image_name_prefix" {
  description = "Prefix for VM image names"
  type        = string
  default     = "bun-macos"
}

variable "image_rebuild_schedule" {
  description = "Cron schedule for rebuilding images"
  type        = string
  default     = "0 2 * * *"  # Daily at 2 AM
}

variable "image_retention_days" {
  description = "Number of days to retain old images"
  type        = number
  default     = 7
}

# Network configuration
variable "network_config" {
  description = "Network configuration"
  type = object({
    cidr_block     = string
    enable_nat     = bool
    enable_vpn     = bool
    allowed_cidrs  = list(string)
  })
  default = {
    cidr_block     = "10.0.0.0/16"
    enable_nat     = true
    enable_vpn     = false
    allowed_cidrs  = ["0.0.0.0/0"]
  }
}

# Security configuration
variable "security_config" {
  description = "Security configuration"
  type = object({
    enable_ssh_access     = bool
    enable_vnc_access     = bool
    ssh_allowed_cidrs     = list(string)
    vnc_allowed_cidrs     = list(string)
    enable_disk_encryption = bool
  })
  default = {
    enable_ssh_access     = true
    enable_vnc_access     = true
    ssh_allowed_cidrs     = ["0.0.0.0/0"]
    vnc_allowed_cidrs     = ["10.0.0.0/16"]
    enable_disk_encryption = true
  }
}

# Monitoring configuration
variable "monitoring_config" {
  description = "Monitoring configuration"
  type = object({
    enable_cloudwatch     = bool
    enable_custom_metrics = bool
    log_retention_days    = number
    alert_email           = string
  })
  default = {
    enable_cloudwatch     = true
    enable_custom_metrics = true
    log_retention_days    = 30
    alert_email           = "devops@oven.sh"
  }
}

# Backup configuration
variable "backup_config" {
  description = "Backup configuration"
  type = object({
    enable_snapshots      = bool
    snapshot_schedule     = string
    snapshot_retention    = number
    enable_cross_region   = bool
  })
  default = {
    enable_snapshots      = true
    snapshot_schedule     = "0 4 * * *"  # Daily at 4 AM
    snapshot_retention    = 7
    enable_cross_region   = false
  }
}

# Cost optimization
variable "cost_optimization" {
  description = "Cost optimization settings"
  type = object({
    enable_spot_instances = bool
    spot_price_max        = number
    enable_hibernation    = bool
    idle_shutdown_timeout = number
  })
  default = {
    enable_spot_instances = false
    spot_price_max        = 0.0
    enable_hibernation    = false
    idle_shutdown_timeout = 3600  # 1 hour
  }
}

# Maintenance configuration
variable "maintenance_config" {
  description = "Maintenance configuration"
  type = object({
    maintenance_window_start = string
    maintenance_window_end   = string
    auto_update_enabled      = bool
    patch_schedule           = string
  })
  default = {
    maintenance_window_start = "02:00"
    maintenance_window_end   = "06:00"
    auto_update_enabled      = true
    patch_schedule           = "0 3 * * 0"  # Weekly on Sunday at 3 AM
  }
}

# Tagging
variable "tags" {
  description = "Additional tags to apply to resources"
  type        = map(string)
  default     = {}
}

# SSH key configuration
variable "ssh_key_name" {
  description = "Name of the SSH key pair"
  type        = string
  default     = "bun-runner-key"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key file"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

# Feature flags
variable "feature_flags" {
  description = "Feature flags for experimental features"
  type = object({
    enable_gpu_passthrough = bool
    enable_nested_virt     = bool
    enable_secure_boot     = bool
    enable_tpm             = bool
  })
  default = {
    enable_gpu_passthrough = true
    enable_nested_virt     = false
    enable_secure_boot     = false
    enable_tpm             = false
  }
}