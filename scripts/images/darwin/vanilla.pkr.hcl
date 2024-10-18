# Generates a macOS VM with unmodified settings.
# See boot.sh for details.

data "external-raw" "boot-script" {
  program = ["sh", "-c", templatefile("boot.sh", var)]
}

source "tart-cli" "bun-darwin-aarch64-vanilla" {
  vm_name      = "bun-darwin-aarch64-${local.release.distro}-${local.release.release}-vanilla"
  from_ipsw    = local.release.ipsw
  cpu_count    = local.cpu_count
  memory_gb    = local.memory_gb
  disk_size_gb = local.disk_size_gb
  ssh_username = local.username
  ssh_password = local.password
  ssh_timeout  = "300s"
  create_grace_time = "30s"
  boot_command = split("\n", data.external-raw.boot-script.result)
}

build {
  sources = ["source.tart-cli.bun-darwin-aarch64-vanilla"]
}
