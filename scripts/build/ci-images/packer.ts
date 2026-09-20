/**
 * The Packer template of a Windows image. Packer creates a VM from the base
 * image, uploads the bake directory, runs `bootstrap.ps1`, restarts, runs
 * Sysprep, and publishes the disk to the Compute Gallery as version 1.0.0 of
 * the image definition named by `image_name`.
 *
 * What is not known until the bake runs comes in as variables: Azure's
 * credentials and resource names, the image's name (it contains the hash of
 * this file), the directory, and the commit.
 */

import type { WindowsImage } from "./image.ts";

/** Every variable the template needs; scripts/ci-image.ts passes them all. */
export const packerVariables = [
  ...["client_id", "client_secret", "subscription_id", "tenant_id"],
  // The resource group the bake's VM is created in, and the gallery's.
  ...["resource_group", "gallery_resource_group", "gallery_name", "location"],
  ...["image_name", "bake_directory", "repo_commit"],
] as const;

/** Where a published image is replicated, besides the gallery's own region: every region CI launches Windows machines in. */
const galleryRegions = [
  ...["australiaeast", "brazilsouth", "canadacentral", "canadaeast", "centralindia", "centralus", "francecentral"],
  ...["germanywestcentral", "italynorth", "japaneast", "japanwest", "koreacentral", "mexicocentral", "northcentralus"],
  ...["northeurope", "southcentralus", "southeastasia", "spaincentral", "swedencentral", "switzerlandnorth"],
  ...["uaenorth", "ukwest", "westeurope", "westus", "westus2", "westus3"],
];

/** Sysprep generalizes the disk so every VM created from it gets its own identity. It must be the last thing that runs. */
const sysprep = String.raw`
Remove-Item -Recurse -Force C:\Windows\Panther -ErrorAction SilentlyContinue
# A pending restart makes Sysprep refuse to run.
Remove-Item 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update' -Name 'RebootRequired' -Force -ErrorAction SilentlyContinue
Remove-Item 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name 'PendingFileRenameOperations' -Force -ErrorAction SilentlyContinue
while ((Get-Service RdAgent).Status -ne 'Running') { Start-Sleep -s 5 }
while ((Get-Service WindowsAzureGuestAgent).Status -ne 'Running') { Start-Sleep -s 5 }
& $env:SystemRoot\System32\Sysprep\Sysprep.exe /oobe /generalize /quiet /quit /mode:vm
$elapsed = 0
while ($true) {
  $state = (Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Setup\State).ImageState
  Write-Output "ImageState: $state ($elapsed s)"
  if ($state -eq 'IMAGE_STATE_GENERALIZE_RESEAL_TO_OOBE') { break }
  if ($elapsed -ge 300) {
    Get-Content "$env:SystemRoot\System32\Sysprep\Panther\setupact.log" -Tail 100 -ErrorAction SilentlyContinue
    throw "Sysprep is stuck at $state"
  }
  Start-Sleep -s 10
  $elapsed += 10
}
`.trim();

/** An HCL heredoc; Packer reads `${` as its own interpolation, and `$${` as a literal `${`. */
function heredoc(text: string): string {
  return `<<-EOT\n${text.replace(/\$\{/g, "$$${")}\nEOT`;
}

export function renderPackerTemplate(image: WindowsImage, pin: { version: string; azurePlugin: string }): string {
  return `# Generated from scripts/build/ci-images/spec.ts. Do not edit.

packer {
  required_version = "= ${pin.version}"
  required_plugins {
    azure = {
      source  = "github.com/hashicorp/azure"
      version = "= ${pin.azurePlugin}"
    }
  }
}

${packerVariables.map(name => `variable "${name}" {\n  type      = string\n  sensitive = ${name === "client_secret"}\n}\n`).join("\n")}
source "azure-arm" "image" {
  client_id       = var.client_id
  client_secret   = var.client_secret
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id

  os_type         = "Windows"
  image_publisher = "${image.base.publisher}"
  image_offer     = "${image.base.offer}"
  image_sku       = "${image.base.sku}"
  image_version   = "${image.base.version}"

  vm_size                   = "${image.bakeVmSize}"
  build_resource_group_name = var.resource_group
  os_disk_size_gb           = 150

  security_type       = "TrustedLaunch"
  secure_boot_enabled = true
  vtpm_enabled        = true

  communicator   = "winrm"
  winrm_use_ssl  = true
  winrm_insecure = true
  winrm_timeout  = "15m"
  winrm_username = "packer"

  # Replicating to every region takes longer than Packer's default hour.
  shared_image_gallery_timeout = "3h"
  shared_image_gallery_destination {
    subscription         = var.subscription_id
    resource_group       = var.gallery_resource_group
    gallery_name         = var.gallery_name
    image_name           = var.image_name
    image_version        = "1.0.0"
    storage_account_type = "Premium_LRS"
    target_region { name = var.location }
${galleryRegions.map(region => `    target_region { name = "${region}" }`).join("\n")}
  }

  azure_tags = {
    os   = "windows"
    arch = "${image.arch}"
  }
}

build {
  sources = ["source.azure-arm.image"]

  provisioner "file" {
    source      = "\${var.bake_directory}/"
    destination = "C:\\\\bake"
  }

  # 3010: done, and a restart is needed; the next step is one.
  provisioner "powershell" {
    inline           = ["& C:\\\\bake\\\\bootstrap.ps1"]
    environment_vars = ["REPO_COMMIT=\${var.repo_commit}"]
    valid_exit_codes = [0, 3010]
  }

  provisioner "windows-restart" {
    restart_timeout = "10m"
  }

  provisioner "powershell" {
    inline = [${heredoc(["Remove-Item -Recurse -Force C:\\bake", sysprep].join("\n"))}
    ]
  }
}
`;
}
