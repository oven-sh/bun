source "azure-arm" "windows-arm64" {
  // Authentication
  client_id       = var.client_id
  client_secret   = var.client_secret
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id

  // Source image — Windows 11 ARM64 (no Windows Server ARM64 exists)
  os_type         = "Windows"
  image_publisher = "MicrosoftWindowsDesktop"
  image_offer     = "windows11preview-arm64"
  image_sku       = "win11-24h2-pro"
  image_version   = "latest"

  // Build VM — ARM64 Cobalt 100
  vm_size         = "Standard_D16ps_v6"

  // Use existing resource group instead of creating a temp one
  build_resource_group_name = var.resource_group
  os_disk_size_gb = 150

  // Security
  security_type       = "TrustedLaunch"
  secure_boot_enabled = true
  vtpm_enabled        = true

  // Networking — Packer creates a temp VNet + public IP + NSG automatically.

  // WinRM communicator
  communicator   = "winrm"
  winrm_use_ssl  = true
  winrm_insecure = true
  winrm_timeout  = "15m"
  winrm_username = "packer"

  // CRITICAL: No managed_image_name — ARM64 doesn't support Managed Images.
  // Packer publishes directly from the VM to the gallery (PR #242 feature).

  shared_image_gallery_destination {
    subscription         = var.subscription_id
    resource_group       = var.gallery_resource_group
    gallery_name         = var.gallery_name
    image_name           = "windows-aarch64-11-build-${var.build_number}"
    image_version        = "1.0.0"
    storage_account_type = "Standard_LRS"
    target_region {
      name = var.location
    }
  }

  azure_tags = {
    os    = "windows"
    arch  = "aarch64"
    build = var.build_number
  }
}

build {
  sources = ["source.azure-arm.windows-arm64"]

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
