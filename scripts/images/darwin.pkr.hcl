packer {
  required_plugins {
    tart = {
      version = ">= 1.12.0"
      source  = "github.com/cirruslabs/tart"
    }
    external = {
      version = ">= 0.0.2"
      source  = "github.com/joomcode/external"
    }
  }
}

data "external-raw" "release" {
  program = ["sh", "-c", "sw_vers -productVersion | awk -F '.' '{print $1}'"]
}

variable "release" {
  type    = number
  default = null
}

locals {
  release = var.release == null ? trimspace(data.external-raw.release.result) : var.release
}

variable "username" {
  type    = string
  default = "admin"
}

variable "password" {
  type      = string
  sensitive = true
  default   = "admin"
}

# IPSWs are available at:
# https://ipsw.me/VirtualMac2,1

locals {
  sequoia = {
    tier = 1
    distro = "sequoia"
    release = "15"
    ipsw = "https://updates.cdn-apple.com/2024FallFCS/fullrestores/062-78489/BDA44327-C79E-4608-A7E0-455A7E91911F/UniversalMac_15.0_24A335_Restore.ipsw"
  }
  sonoma = {
    tier = 2
    distro = "sonoma"
    release = "14"
    ipsw = "https://updates.cdn-apple.com/2023FallFCS/fullrestores/042-54934/0E101AD6-3117-4B63-9BF1-143B6DB9270A/UniversalMac_14.0_23A344_Restore.ipsw"
  }
  ventura = {
    tier = 2
    distro = "ventura"
    release = "13"
    ipsw = "https://updates.cdn-apple.com/2022FallFCS/fullrestores/012-92188/2C38BCD1-2BFF-4A10-B358-94E8E28BE805/UniversalMac_13.0_22A380_Restore.ipsw"
  }
  releases = {
    "15" = local.sequoia
    "14" = local.sonoma
    "13" = local.ventura
  }
}

data "external-raw" "boot-script" {
  program = ["sh", "-c", templatefile("boot.sh", {
    release = var.release == null ? trimspace(data.external-raw.release.result) : var.release
    username = var.username
    password = var.password
  })]
}

source "tart-cli" "bun-darwin-aarch64" {
  vm_name      = "bun-darwin-aarch64-${local.releases[local.release].distro}-${local.release}-vanilla"
  from_ipsw    = local.releases[local.release].ipsw
  cpu_count    = 2
  memory_gb    = 4
  disk_size_gb = 30
  ssh_username = var.username
  ssh_password = var.password
  ssh_timeout  = "300s"
  create_grace_time = "30s"
  boot_command = split("\n", data.external-raw.boot-script.result)
}

build {
  sources = ["source.tart-cli.bun-darwin-aarch64"]

  provisioner "shell" {
    inline = ["sh", "-c", templatefile("provision.sh", {
      release = var.release == null ? trimspace(data.external-raw.release.result) : var.release
      username = var.username
      password = var.password
    })]
  }
}
