packer {
  required_plugins {
    azure = {
      source  = "github.com/hashicorp/azure"
      version = "= 2.5.0"
    }
  }
}

// Shared variables for all Windows image builds

variable "client_id" {
  type    = string
  default = env("AZURE_CLIENT_ID")
}

variable "client_secret" {
  type      = string
  sensitive = true
  default   = env("AZURE_CLIENT_SECRET")
}

variable "subscription_id" {
  type    = string
  default = env("AZURE_SUBSCRIPTION_ID")
}

variable "tenant_id" {
  type    = string
  default = env("AZURE_TENANT_ID")
}

variable "resource_group" {
  type    = string
  default = env("AZURE_RESOURCE_GROUP")
}

variable "location" {
  type    = string
  default = "eastus2"
}

variable "gallery_name" {
  type    = string
  default = "bunCIGallery2"
}

variable "build_number" {
  type    = string
  default = "0"
}

variable "image_name" {
  type        = string
  default     = ""
  description = "Gallery image definition name. If empty, derived from build_number."
}

variable "bootstrap_script" {
  type    = string
  default = "scripts/bootstrap.ps1"
}

variable "agent_script" {
  type    = string
  default = ""
  description = "Path to bundled agent.mjs. If empty, agent install is skipped."
}

variable "gallery_resource_group" {
  type    = string
  default = "BUN-CI"
  description = "Resource group containing the Compute Gallery (may differ from build RG)"
}
