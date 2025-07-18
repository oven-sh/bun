# VM instance outputs
output "vm_instances" {
  description = "Details of all created VM instances"
  value = {
    for key, vm in macstadium_vm.runners : key => {
      id           = vm.id
      name         = vm.name
      ip_address   = vm.network_interface[0].ip_address
      image_id     = vm.image_id
      status       = vm.status
      macos_version = regex("macos-([0-9]+)", key)[0]
      instance_type = vm.instance_type
      cpu_count    = vm.cpu_count
      memory_gb    = vm.memory_gb
      disk_size    = vm.disk_size
      created_at   = vm.created_at
      updated_at   = vm.updated_at
    }
  }
}

output "vm_instances_by_version" {
  description = "VM instances grouped by macOS version"
  value = {
    for version in ["13", "14", "15"] : "macos_${version}" => {
      for key, vm in macstadium_vm.runners : key => {
        id           = vm.id
        name         = vm.name
        ip_address   = vm.network_interface[0].ip_address
        status       = vm.status
      }
      if can(regex("^${version}-", key))
    }
  }
}

# Network outputs
output "network_details" {
  description = "Network configuration details"
  value = {
    network_id   = macstadium_network.runner_network.id
    cidr_block   = macstadium_network.runner_network.cidr_block
    name         = macstadium_network.runner_network.name
    status       = macstadium_network.runner_network.status
  }
}

output "security_group_details" {
  description = "Security group configuration details"
  value = {
    security_group_id = macstadium_security_group.runner_sg.id
    name             = macstadium_security_group.runner_sg.name
    description      = macstadium_security_group.runner_sg.description
    ingress_rules    = macstadium_security_group.runner_sg.ingress
    egress_rules     = macstadium_security_group.runner_sg.egress
  }
}

# Load balancer outputs
output "load_balancer_details" {
  description = "Load balancer configuration details"
  value = {
    dns_name           = macstadium_load_balancer.runner_lb.dns_name
    zone_id            = macstadium_load_balancer.runner_lb.zone_id
    load_balancer_type = macstadium_load_balancer.runner_lb.load_balancer_type
    target_group_arn   = macstadium_load_balancer.runner_lb.target_group[0].arn
    health_check       = macstadium_load_balancer.runner_lb.health_check[0]
  }
}

# Auto-scaling outputs
output "autoscaling_details" {
  description = "Auto-scaling group configuration details"
  value = {
    asg_name         = macstadium_autoscaling_group.runner_asg.name
    min_size         = macstadium_autoscaling_group.runner_asg.min_size
    max_size         = macstadium_autoscaling_group.runner_asg.max_size
    desired_capacity = macstadium_autoscaling_group.runner_asg.desired_capacity
    launch_template  = macstadium_autoscaling_group.runner_asg.launch_template[0]
  }
}

# SSH key outputs
output "ssh_key_details" {
  description = "SSH key configuration details"
  value = {
    key_name        = macstadium_ssh_key.runner_key.name
    fingerprint     = macstadium_ssh_key.runner_key.fingerprint
    key_pair_id     = macstadium_ssh_key.runner_key.id
  }
}

# Image outputs
output "image_details" {
  description = "Details of images used for VM creation"
  value = {
    macos_13 = {
      id           = data.macstadium_image.macos_13.id
      name         = data.macstadium_image.macos_13.name
      description  = data.macstadium_image.macos_13.description
      created_date = data.macstadium_image.macos_13.creation_date
      size         = data.macstadium_image.macos_13.size
    }
    macos_14 = {
      id           = data.macstadium_image.macos_14.id
      name         = data.macstadium_image.macos_14.name
      description  = data.macstadium_image.macos_14.description
      created_date = data.macstadium_image.macos_14.creation_date
      size         = data.macstadium_image.macos_14.size
    }
    macos_15 = {
      id           = data.macstadium_image.macos_15.id
      name         = data.macstadium_image.macos_15.name
      description  = data.macstadium_image.macos_15.description
      created_date = data.macstadium_image.macos_15.creation_date
      size         = data.macstadium_image.macos_15.size
    }
  }
}

# Fleet statistics
output "fleet_statistics" {
  description = "Statistics about the VM fleet"
  value = {
    total_vms = sum([
      var.fleet_size.macos_13,
      var.fleet_size.macos_14,
      var.fleet_size.macos_15
    ])
    vms_by_version = {
      macos_13 = var.fleet_size.macos_13
      macos_14 = var.fleet_size.macos_14
      macos_15 = var.fleet_size.macos_15
    }
    total_cpu_cores = sum([
      var.fleet_size.macos_13,
      var.fleet_size.macos_14,
      var.fleet_size.macos_15
    ]) * var.vm_configuration.cpu_count
    total_memory_gb = sum([
      var.fleet_size.macos_13,
      var.fleet_size.macos_14,
      var.fleet_size.macos_15
    ]) * var.vm_configuration.memory_gb
    total_disk_gb = sum([
      var.fleet_size.macos_13,
      var.fleet_size.macos_14,
      var.fleet_size.macos_15
    ]) * var.vm_configuration.disk_size
  }
}

# Connection information
output "connection_info" {
  description = "Information for connecting to the infrastructure"
  value = {
    ssh_command_template = "ssh -i ~/.ssh/bun-runner admin@{vm_ip_address}"
    vnc_port_range      = "5900-5999"
    health_check_url    = "http://{vm_ip_address}:8080/health"
    buildkite_tags      = "queue=macos,os=macos,arch=$(uname -m)"
  }
}

# Resource ARNs and IDs
output "resource_arns" {
  description = "ARNs and IDs of created resources"
  value = {
    vm_ids = [
      for vm in macstadium_vm.runners : vm.id
    ]
    network_id           = macstadium_network.runner_network.id
    security_group_id    = macstadium_security_group.runner_sg.id
    load_balancer_arn    = macstadium_load_balancer.runner_lb.arn
    autoscaling_group_arn = macstadium_autoscaling_group.runner_asg.arn
    launch_template_id   = macstadium_launch_template.runner_template.id
  }
}

# Monitoring and alerting
output "monitoring_endpoints" {
  description = "Monitoring and alerting endpoints"
  value = {
    cloudwatch_namespace = "BunCI/MacOSRunners"
    alarm_arns = [
      macstadium_cloudwatch_metric_alarm.scale_up.arn,
      macstadium_cloudwatch_metric_alarm.scale_down.arn
    ]
    scaling_policy_arns = [
      macstadium_autoscaling_policy.scale_up.arn,
      macstadium_autoscaling_policy.scale_down.arn
    ]
  }
}

# Cost information
output "cost_information" {
  description = "Cost-related information"
  value = {
    estimated_hourly_cost = format("$%.2f", sum([
      var.fleet_size.macos_13,
      var.fleet_size.macos_14,
      var.fleet_size.macos_15
    ]) * 0.50)  # Estimated cost per hour per VM
    estimated_monthly_cost = format("$%.2f", sum([
      var.fleet_size.macos_13,
      var.fleet_size.macos_14,
      var.fleet_size.macos_15
    ]) * 0.50 * 24 * 30)  # Estimated monthly cost
    cost_optimization_enabled = var.cost_optimization.enable_spot_instances
  }
}

# Terraform state information
output "terraform_state" {
  description = "Terraform state information"
  value = {
    workspace        = terraform.workspace
    terraform_version = "~> 1.0"
    provider_versions = {
      macstadium = "~> 1.0"
    }
    last_updated = timestamp()
  }
}

# Summary output for easy reference
output "deployment_summary" {
  description = "Summary of the deployment"
  value = {
    project_name = var.project_name
    environment  = var.environment
    region      = var.region
    total_vms   = sum([
      var.fleet_size.macos_13,
      var.fleet_size.macos_14,
      var.fleet_size.macos_15
    ])
    load_balancer_dns = macstadium_load_balancer.runner_lb.dns_name
    autoscaling_enabled = var.autoscaling_enabled
    backup_enabled = var.backup_config.enable_snapshots
    monitoring_enabled = var.monitoring_config.enable_cloudwatch
    deployment_time = timestamp()
    status = "deployed"
  }
}