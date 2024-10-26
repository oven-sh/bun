# Generates a macOS VM with software installed to build and test Bun.

source "tart-cli" "bun-darwin-aarch64" {
  vm_name      = "bun-darwin-aarch64-${local.release.distro}-${local.release.release}"
  vm_base_name = "bun-darwin-aarch64-vanilla-${local.release.distro}-${local.release.release}"
  cpu_count    = local.cpu_count
  memory_gb    = local.memory_gb
  disk_size_gb = local.disk_size_gb
  ssh_username = local.username
  ssh_password = local.password
  ssh_timeout  = "120s"
  headless     = true
}

build {
  sources = ["source.tart-cli.bun-darwin-aarch64"]

  provisioner "file" {
    content = file("../../scripts/bootstrap.sh")
    destination = "/tmp/bootstrap.sh"
  }

  provisioner "shell" {
    inline = ["CI=true sh /tmp/bootstrap.sh"]
  }

  provisioner "file" {
    source = "darwin/plists/"
    destination = "/tmp/"
  }

  provisioner "shell" {
    inline = [
      "sudo ls /tmp/",
      "sudo mv /tmp/*.plist /Library/LaunchDaemons/",
      "sudo chown root:wheel /Library/LaunchDaemons/*.plist",
      "sudo chmod 644 /Library/LaunchDaemons/*.plist",
    ]
  }

  provisioner "shell" {
    inline = ["sudo rm -rf /tmp/*"]
  }
}
