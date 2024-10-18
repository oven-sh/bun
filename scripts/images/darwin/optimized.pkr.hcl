# Generates a macOS VM with optimized settings for virtualized environments.
# See optimize.sh for details.

source "tart-cli" "bun-darwin-aarch64-optimized" {
  vm_name      = "bun-darwin-aarch64-${local.release.distro}-${local.release.release}-optimized"
  vm_base_name = "bun-darwin-aarch64-${local.release.distro}-${local.release.release}-vanilla"
  cpu_count    = local.cpu_count
  memory_gb    = local.memory_gb
  disk_size_gb = local.disk_size_gb
  ssh_username = local.username
  ssh_password = local.password
  boot_command = ["<wait15s>${local.password}<enter>"]
}

build {
  sources = ["source.tart-cli.bun-darwin-aarch64-optimized"]

  provisioner "shell" {
    script = "scripts/images/darwin/optimize.sh"
    env = {
      username = local.username
      password = local.password
    }
    execute_command = "chmod +x {{ .Path }}; echo '${local.password}' | sudo -S sh -c '{{ .Vars }} {{ .Path }}'"
  }
}
