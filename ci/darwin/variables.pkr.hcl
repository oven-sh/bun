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

variable "release" {
  type    = number
  default = 13
}

variable "username" {
  type    = string
  default = "admin"
}

variable "password" {
  type    = string
  default = "admin"
}

variable "cpu_count" {
  type    = number
  default = 2
}

variable "memory_gb" {
  type    = number
  default = 4
}

variable "disk_size_gb" {
  type    = number
  default = 50
}

locals {
  sequoia = {
    tier    = 1
    distro  = "sequoia"
    release = "15"
    ipsw    = "https://updates.cdn-apple.com/2024FallFCS/fullrestores/062-78489/BDA44327-C79E-4608-A7E0-455A7E91911F/UniversalMac_15.0_24A335_Restore.ipsw"
  }

  sonoma = {
    tier    = 2
    distro  = "sonoma"
    release = "14"
    ipsw    = "https://updates.cdn-apple.com/2023FallFCS/fullrestores/042-54934/0E101AD6-3117-4B63-9BF1-143B6DB9270A/UniversalMac_14.0_23A344_Restore.ipsw"
  }

  ventura = {
    tier    = 2
    distro  = "ventura"
    release = "13"
    ipsw    = "https://updates.cdn-apple.com/2022FallFCS/fullrestores/012-92188/2C38BCD1-2BFF-4A10-B358-94E8E28BE805/UniversalMac_13.0_22A380_Restore.ipsw"
  }

  releases = {
    15 = local.sequoia
    14 = local.sonoma
    13 = local.ventura
  }

  release      = local.releases[var.release]
  username     = var.username
  password     = var.password
  cpu_count    = var.cpu_count
  memory_gb    = var.memory_gb
  disk_size_gb = var.disk_size_gb
}
