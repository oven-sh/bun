terraform {
  required_version = ">= 1.0"
  
  required_providers {
    macstadium = {
      source  = "macstadium/macstadium"
      version = "~> 1.0"
    }
  }
  
  backend "s3" {
    bucket = "bun-terraform-state"
    key    = "macos-runners/terraform.tfstate"
    region = "us-west-2"
  }
}

provider "macstadium" {
  api_key  = var.macstadium_api_key
  endpoint = var.macstadium_endpoint
}

# Variables
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

variable "buildkite_agent_token" {
  description = "Buildkite agent token"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub token for accessing private repositories"
  type        = string
  sensitive   = true
}

variable "image_name_prefix" {
  description = "Prefix for VM image names"
  type        = string
  default     = "bun-macos"
}

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
}

variable "vm_configuration" {
  description = "VM configuration settings"
  type = object({
    cpu_count  = number
    memory_gb  = number
    disk_size  = number
  })
  default = {
    cpu_count = 12
    memory_gb = 32
    disk_size = 500
  }
}

# Data sources to get latest images
data "macstadium_image" "macos_13" {
  name_regex = "^${var.image_name_prefix}-13-.*"
  most_recent = true
}

data "macstadium_image" "macos_14" {
  name_regex = "^${var.image_name_prefix}-14-.*"
  most_recent = true
}

data "macstadium_image" "macos_15" {
  name_regex = "^${var.image_name_prefix}-15-.*"
  most_recent = true
}

# Local values
locals {
  common_tags = {
    Project     = "bun-ci"
    Environment = "production"
    ManagedBy   = "terraform"
    Purpose     = "buildkite-runners"
  }
  
  vm_configs = {
    macos_13 = {
      image_id = data.macstadium_image.macos_13.id
      count    = var.fleet_size.macos_13
      version  = "13"
    }
    macos_14 = {
      image_id = data.macstadium_image.macos_14.id
      count    = var.fleet_size.macos_14
      version  = "14"
    }
    macos_15 = {
      image_id = data.macstadium_image.macos_15.id
      count    = var.fleet_size.macos_15
      version  = "15"
    }
  }
}

# VM instances for each macOS version
resource "macstadium_vm" "runners" {
  for_each = {
    for vm_combo in flatten([
      for version, config in local.vm_configs : [
        for i in range(config.count) : {
          key     = "${version}-${i + 1}"
          version = version
          config  = config
          index   = i + 1
        }
      ]
    ]) : vm_combo.key => vm_combo
  }

  name     = "bun-runner-${each.value.version}-${each.value.index}"
  image_id = each.value.config.image_id
  
  cpu_count = var.vm_configuration.cpu_count
  memory_gb = var.vm_configuration.memory_gb
  disk_size = var.vm_configuration.disk_size
  
  # Network configuration
  network_interface {
    network_id = macstadium_network.runner_network.id
    ip_address = cidrhost(macstadium_network.runner_network.cidr_block, 10 + index(keys(local.vm_configs), each.value.version) * 100 + each.value.index)
  }
  
  # Enable GPU passthrough for better performance
  gpu_passthrough = true
  
  # Enable VNC for debugging
  vnc_enabled = true
  
  # SSH configuration
  ssh_keys = [macstadium_ssh_key.runner_key.id]
  
  # Startup script
  user_data = templatefile("${path.module}/user-data.sh", {
    buildkite_agent_token = var.buildkite_agent_token
    github_token         = var.github_token
    macos_version        = each.value.version
    vm_name              = "bun-runner-${each.value.version}-${each.value.index}"
  })
  
  # Auto-start VM
  auto_start = true
  
  # Shutdown behavior
  auto_shutdown = false
  
  tags = merge(local.common_tags, {
    Name         = "bun-runner-${each.value.version}-${each.value.index}"
    MacOSVersion = each.value.version
    VmIndex      = each.value.index
  })
}

# Network configuration
resource "macstadium_network" "runner_network" {
  name       = "bun-runner-network"
  cidr_block = "10.0.0.0/16"
  
  tags = merge(local.common_tags, {
    Name = "bun-runner-network"
  })
}

# SSH key for VM access
resource "macstadium_ssh_key" "runner_key" {
  name       = "bun-runner-key"
  public_key = file("${path.module}/ssh-keys/bun-runner.pub")
  
  tags = merge(local.common_tags, {
    Name = "bun-runner-key"
  })
}

# Security group for runner VMs
resource "macstadium_security_group" "runner_sg" {
  name        = "bun-runner-sg"
  description = "Security group for Bun CI runner VMs"
  
  # SSH access
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  # VNC access (for debugging)
  ingress {
    from_port   = 5900
    to_port     = 5999
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
  
  # HTTP/HTTPS outbound
  egress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  # Git (SSH)
  egress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  # DNS
  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = merge(local.common_tags, {
    Name = "bun-runner-sg"
  })
}

# Load balancer for distributing jobs
resource "macstadium_load_balancer" "runner_lb" {
  name               = "bun-runner-lb"
  load_balancer_type = "application"
  
  # Health check configuration
  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    port                = 8080
    protocol            = "HTTP"
  }
  
  # Target group for all runner VMs
  target_group {
    name     = "bun-runners"
    port     = 8080
    protocol = "HTTP"
    
    targets = [
      for vm in macstadium_vm.runners : {
        id   = vm.id
        port = 8080
      }
    ]
  }
  
  tags = merge(local.common_tags, {
    Name = "bun-runner-lb"
  })
}

# Auto-scaling configuration
resource "macstadium_autoscaling_group" "runner_asg" {
  name                 = "bun-runner-asg"
  min_size             = 2
  max_size             = 20
  desired_capacity     = sum(values(var.fleet_size))
  health_check_type    = "ELB"
  health_check_grace_period = 300
  
  # Launch template reference
  launch_template {
    id      = macstadium_launch_template.runner_template.id
    version = "$Latest"
  }
  
  # Scaling policies
  target_group_arns = [macstadium_load_balancer.runner_lb.target_group[0].arn]
  
  tags = merge(local.common_tags, {
    Name = "bun-runner-asg"
  })
}

# Launch template for auto-scaling
resource "macstadium_launch_template" "runner_template" {
  name          = "bun-runner-template"
  image_id      = data.macstadium_image.macos_15.id
  instance_type = "mac-mini-m2-pro"
  
  key_name = macstadium_ssh_key.runner_key.name
  
  security_group_ids = [macstadium_security_group.runner_sg.id]
  
  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    buildkite_agent_token = var.buildkite_agent_token
    github_token         = var.github_token
    macos_version        = "15"
    vm_name              = "bun-runner-asg-${timestamp()}"
  }))
  
  tags = merge(local.common_tags, {
    Name = "bun-runner-template"
  })
}

# CloudWatch alarms for scaling
resource "macstadium_cloudwatch_metric_alarm" "scale_up" {
  alarm_name          = "bun-runner-scale-up"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "This metric monitors ec2 cpu utilization"
  alarm_actions       = [macstadium_autoscaling_policy.scale_up.arn]
  
  dimensions = {
    AutoScalingGroupName = macstadium_autoscaling_group.runner_asg.name
  }
}

resource "macstadium_cloudwatch_metric_alarm" "scale_down" {
  alarm_name          = "bun-runner-scale-down"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "300"
  statistic           = "Average"
  threshold           = "20"
  alarm_description   = "This metric monitors ec2 cpu utilization"
  alarm_actions       = [macstadium_autoscaling_policy.scale_down.arn]
  
  dimensions = {
    AutoScalingGroupName = macstadium_autoscaling_group.runner_asg.name
  }
}

# Scaling policies
resource "macstadium_autoscaling_policy" "scale_up" {
  name                   = "bun-runner-scale-up"
  scaling_adjustment     = 2
  adjustment_type        = "ChangeInCapacity"
  cooldown              = 300
  autoscaling_group_name = macstadium_autoscaling_group.runner_asg.name
}

resource "macstadium_autoscaling_policy" "scale_down" {
  name                   = "bun-runner-scale-down"
  scaling_adjustment     = -1
  adjustment_type        = "ChangeInCapacity"
  cooldown              = 300
  autoscaling_group_name = macstadium_autoscaling_group.runner_asg.name
}

# Outputs
output "vm_instances" {
  description = "Details of created VM instances"
  value = {
    for key, vm in macstadium_vm.runners : key => {
      id         = vm.id
      name       = vm.name
      ip_address = vm.network_interface[0].ip_address
      image_id   = vm.image_id
      status     = vm.status
    }
  }
}

output "load_balancer_dns" {
  description = "DNS name of the load balancer"
  value       = macstadium_load_balancer.runner_lb.dns_name
}

output "network_id" {
  description = "ID of the runner network"
  value       = macstadium_network.runner_network.id
}

output "security_group_id" {
  description = "ID of the runner security group"
  value       = macstadium_security_group.runner_sg.id
}

output "autoscaling_group_name" {
  description = "Name of the autoscaling group"
  value       = macstadium_autoscaling_group.runner_asg.name
}