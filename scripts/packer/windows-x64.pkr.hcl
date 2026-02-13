packer {
  required_plugins {
    azure = {
      source  = "github.com/hashicorp/azure"
      version = ">= 2.5.0"
    }
  }
}

source "azure-arm" "windows-x64" {
  // Authentication (from env vars or -var flags)
  client_id       = var.client_id
  client_secret   = var.client_secret
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id

  // Source image — Windows Server 2019 Gen2
  os_type         = "Windows"
  image_publisher = "MicrosoftWindowsServer"
  image_offer     = "WindowsServer"
  image_sku       = "2019-datacenter-gensecond"
  image_version   = "latest"

  // Build VM
  vm_size         = "Standard_D16ds_v6"
  location        = var.location
  os_disk_size_gb = 150

  // Security
  security_type       = "TrustedLaunch"
  secure_boot_enabled = true
  vtpm_enabled        = true

  // Networking — use existing VNet for outbound internet
  virtual_network_name                = "bun-ci-vnet"
  virtual_network_subnet_name         = "default"
  virtual_network_resource_group_name = var.resource_group

  // WinRM communicator — Packer auto-configures via temp Key Vault
  communicator   = "winrm"
  winrm_use_ssl  = true
  winrm_insecure = true
  winrm_timeout  = "15m"
  winrm_username = "packer"

  // Output — Managed Image (x64 supports this)
  managed_image_name                = "windows-x64-2019-build-${var.build_number}"
  managed_image_resource_group_name = var.resource_group

  // Also publish to Compute Gallery
  shared_image_gallery_destination {
    subscription         = var.subscription_id
    resource_group       = var.resource_group
    gallery_name         = var.gallery_name
    image_name           = "windows-x64-2019-build-${var.build_number}"
    image_version        = "1.0.0"
    storage_account_type = "Standard_LRS"
    target_region {
      name = var.location
    }
  }

  azure_tags = {
    os    = "windows"
    arch  = "x64"
    build = var.build_number
  }
}

build {
  sources = ["source.azure-arm.windows-x64"]

  // Step 1: Run bootstrap — installs all build dependencies
  provisioner "powershell" {
    script           = var.bootstrap_script
    valid_exit_codes = [0, 3010]
    environment_vars = ["CI=true"]
  }

  // Step 2: Upload agent.mjs
  provisioner "file" {
    source      = var.agent_script
    destination = "C:\\buildkite-agent\\agent.mjs"
  }

  // Step 3: Install agent service via nssm
  provisioner "powershell" {
    inline = [
      "C:\\Scoop\\apps\\nodejs\\current\\node.exe C:\\buildkite-agent\\agent.mjs install"
    ]
    valid_exit_codes = [0]
  }

  // Step 4: Sysprep — MUST be last provisioner
  provisioner "powershell" {
    inline = [
      "Write-Output '>>> Waiting for Azure Guest Agent...'",
      "while ((Get-Service RdAgent).Status -ne 'Running') { Start-Sleep -s 5 }",
      "while ((Get-Service WindowsAzureGuestAgent).Status -ne 'Running') { Start-Sleep -s 5 }",
      "Write-Output '>>> Running Sysprep...'",
      "& $env:SystemRoot\\System32\\Sysprep\\Sysprep.exe /oobe /generalize /quiet /quit /mode:vm",
      "while ($true) {",
      "  $imageState = (Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Setup\\State).ImageState",
      "  Write-Output $imageState",
      "  if ($imageState -eq 'IMAGE_STATE_GENERALIZE_RESEAL_TO_OOBE') { break }",
      "  Start-Sleep -s 10",
      "}",
      "Write-Output '>>> Sysprep complete.'"
    ]
  }
}
