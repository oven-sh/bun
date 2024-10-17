packer {
  required_plugins {
    tart = {
      version = ">= 1.12.0"
      source  = "github.com/cirruslabs/tart"
    }
  }
}

variable "distro" {
  type    = string
  default = "sequoia"
}

variable "username" {
  type    = string
  default = "administrator"
}

variable "password" {
  type      = string
  sensitive = true
  default   = "administrator!?"
}

# IPSWs are available at:
# https://ipsw.me/VirtualMac2,1

locals {
  sequoia = {
    tier = 1
    release = "15"
    ipsw = "https://updates.cdn-apple.com/2024FallFCS/fullrestores/062-78489/BDA44327-C79E-4608-A7E0-455A7E91911F/UniversalMac_15.0_24A335_Restore.ipsw"
  }
  sonoma = {
    tier = 2
    release = "14"
    ipsw = "https://updates.cdn-apple.com/2023FallFCS/fullrestores/042-54934/0E101AD6-3117-4B63-9BF1-143B6DB9270A/UniversalMac_14.0_23A344_Restore.ipsw"
  }
  ventura = {
    tier = 2
    release = "13"
    ipsw = "https://updates.cdn-apple.com/2022FallFCS/fullrestores/012-92188/2C38BCD1-2BFF-4A10-B358-94E8E28BE805/UniversalMac_13.0_22A380_Restore.ipsw"
  }
  provision_script = templatefile("provision.darwin.sh", {
    username = var.username
    password = var.password
  })
}

source "tart-cli" "bun-darwin-aarch64" {
  vm_name      = "bun-darwin-aarch64-${var.distro}-${local[var.distro].release}"
  from_ipsw    = local[var.distro].ipsw
  cpu_count    = 2
  memory_gb    = 4
  disk_size_gb = 30
  ssh_username = var.username
  ssh_password = var.password
  ssh_timeout  = "300s"
  create_grace_time = "30s"
  boot_command = [
    "<wait60s><spacebar>", # hello, hola, bonjour, etc.
    "<wait30s>italiano<esc>english<enter>", # Select Your Country and Region
    "<wait30s>united states<leftShiftOn><tab><leftShiftOff><spacebar>", # Select Your Country and Region
    "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>", # Written and Spoken Languages
    "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>", # Accessibility
    "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>", # Data & Privacy
    "<wait10s><tab><tab><tab><spacebar>", # Migration Assistant
    "<wait10s><leftShiftOn><tab><leftShiftOff><leftShiftOn><tab><leftShiftOff><spacebar>", # Sign In with Your Apple ID
    "<wait10s><tab><spacebar>", # Are you sure you want to skip signing in with an Apple ID?
    "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>", # Terms and Conditions
    "<wait10s><tab><spacebar>", # I have read and agree to the macOS Software License Agreement
    "<wait10s>${var.username}<tab><tab>${var.password}<tab>${var.password}<tab><tab><tab><spacebar>", # Create a Computer Account
    "<wait120s><leftShiftOn><tab><leftShiftOff><spacebar>", # Enable Location Services
    "<wait10s><tab><spacebar>", # Are you sure you don't want to use Location Services?
    "<wait10s><tab>UTC<enter><leftShiftOn><tab><leftShiftOff><spacebar>", # Select Your Time Zone
    "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>", # Analytics
    "<wait10s><tab><spacebar>", # Screen Time
    "<wait10s><tab><spacebar><leftShiftOn><tab><leftShiftOff><spacebar>", # Siri
    "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>", # Choose Your Look
    "<wait10s><spacebar>", # Welcome to Mac
    "<wait10s><leftAltOn><spacebar><leftAltOff>Terminal<enter>", # Enable Keyboard navigation
    "<wait10s>defaults write NSGlobalDomain AppleKeyboardUIMode -int 3<enter>",
    "<wait10s><leftAltOn>q<leftAltOff>",
    "<wait10s><leftAltOn><spacebar><leftAltOff>System Settings<enter>", # Now that the installation is done, open "System Settings"
    "<wait10s><leftAltOn>f<leftAltOff>sharing<enter>", # Navigate to "Sharing"
    "<wait10s><tab><tab><tab><tab><tab><spacebar>", # Navigate to "Screen Sharing" and enable it
    "<wait10s><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><spacebar>", # Navigate to "Remote Login" and enable it
    "<wait10s><leftAltOn>q<leftAltOff>", # Quit System Settings
  ]
}

build {
  sources = ["source.tart-cli.bun-darwin-aarch64"]

  provisioner "shell" {
    inline = [local.provision_script]
  }
}
