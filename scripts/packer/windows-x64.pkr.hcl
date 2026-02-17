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

  // Build VM — only used during image creation, not for CI runners.
  // CI runner VM sizes are set in ci.mjs (azureVmSizes).
  vm_size         = "Standard_D4ds_v6"

  // Use existing resource group instead of creating a temp one
  build_resource_group_name = var.resource_group
  os_disk_size_gb = 150

  // Security
  security_type       = "TrustedLaunch"
  secure_boot_enabled = true
  vtpm_enabled        = true

  // Networking — Packer creates a temp VNet + public IP + NSG automatically.
  // WinRM needs the public IP to connect from CI runners.

  // WinRM communicator — Packer auto-configures via temp Key Vault
  communicator   = "winrm"
  winrm_use_ssl  = true
  winrm_insecure = true
  winrm_timeout  = "15m"
  winrm_username = "packer"

  // Output — Managed Image (x64 supports this)

  // Also publish to Compute Gallery
  shared_image_gallery_destination {
    subscription         = var.subscription_id
    resource_group       = var.gallery_resource_group
    gallery_name         = var.gallery_name
    image_name           = var.image_name != "" ? var.image_name : "windows-x64-2019-build-${var.build_number}"
    image_version        = "1.0.0"
    storage_account_type = "Standard_LRS"
    target_region { name = var.location }
    target_region { name = "australiaeast" }
    target_region { name = "brazilsouth" }
    target_region { name = "canadacentral" }
    target_region { name = "canadaeast" }
    target_region { name = "centralindia" }
    target_region { name = "centralus" }
    target_region { name = "francecentral" }
    target_region { name = "germanywestcentral" }
    target_region { name = "italynorth" }
    target_region { name = "japaneast" }
    target_region { name = "japanwest" }
    target_region { name = "koreacentral" }
    target_region { name = "mexicocentral" }
    target_region { name = "northcentralus" }
    target_region { name = "northeurope" }
    target_region { name = "southcentralus" }
    target_region { name = "southeastasia" }
    target_region { name = "spaincentral" }
    target_region { name = "swedencentral" }
    target_region { name = "switzerlandnorth" }
    target_region { name = "uaenorth" }
    target_region { name = "ukwest" }
    target_region { name = "westeurope" }
    target_region { name = "westus" }
    target_region { name = "westus2" }
    target_region { name = "westus3" }
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

  // Step 4: Reboot to clear pending updates (VS Build Tools, Windows Updates)
  provisioner "windows-restart" {
    restart_timeout = "10m"
  }

  // Step 5: Sysprep — MUST be last provisioner
  provisioner "powershell" {
    inline = [
      "Remove-Item -Recurse -Force C:\\Windows\\Panther -ErrorAction SilentlyContinue",
      "Write-Output '>>> Clearing pending reboot flags...'",
      "Remove-Item 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending' -Recurse -Force -ErrorAction SilentlyContinue",
      "Remove-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update' -Name 'RebootRequired' -Force -ErrorAction SilentlyContinue",
      "Remove-Item 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired' -Recurse -Force -ErrorAction SilentlyContinue",
      "Remove-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name 'PendingFileRenameOperations' -Force -ErrorAction SilentlyContinue",
      "Write-Output '>>> Waiting for Azure Guest Agent...'",
      "while ((Get-Service RdAgent).Status -ne 'Running') { Start-Sleep -s 5 }",
      "while ((Get-Service WindowsAzureGuestAgent).Status -ne 'Running') { Start-Sleep -s 5 }",
      "Write-Output '>>> Running Sysprep...'",
      "$global:LASTEXITCODE = 0",
      "& $env:SystemRoot\\System32\\Sysprep\\Sysprep.exe /oobe /generalize /quiet /quit /mode:vm",
      "$timeout = 300; $elapsed = 0",
      "while ($true) {",
      "  $imageState = (Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Setup\\State).ImageState",
      "  Write-Output \"ImageState: $imageState ($${elapsed}s)\"",
      "  if ($imageState -eq 'IMAGE_STATE_GENERALIZE_RESEAL_TO_OOBE') { break }",
      "  if ($elapsed -ge $timeout) {",
      "    Write-Error \"Timed out after $${timeout}s -- stuck at $imageState\"",
      "    Get-Content \"$env:SystemRoot\\System32\\Sysprep\\Panther\\setupact.log\" -Tail 100 -ErrorAction SilentlyContinue",
      "    exit 1",
      "  }",
      "  Start-Sleep -s 10",
      "  $elapsed += 10",
      "}",
      "Write-Output '>>> Sysprep complete.'"
    ]
  }
}
