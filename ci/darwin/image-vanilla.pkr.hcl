# Generates a vanilla macOS VM with optimized settings for virtualized environments.
# See login.sh and optimize.sh for details.

data "external-raw" "boot-script" {
  program = ["sh", "-c", templatefile("scripts/boot-image.sh", var)]
}

source "tart-cli" "bun-darwin-aarch64-vanilla" {
  vm_name      = "bun-darwin-aarch64-vanilla-${local.release.distro}-${local.release.release}"
  from_ipsw    = local.release.ipsw
  cpu_count    = local.cpu_count
  memory_gb    = local.memory_gb
  disk_size_gb = local.disk_size_gb
  ssh_username = local.username
  ssh_password = local.password
  ssh_timeout  = "120s"
  create_grace_time = "30s"
  boot_command = split("\n", data.external-raw.boot-script.result)
  headless     = true # Disable if you need to debug why the boot_command is not working
}

build {
  sources = ["source.tart-cli.bun-darwin-aarch64-vanilla"]

  provisioner "file" {
    content = file("scripts/setup-login.sh")
    destination = "/tmp/setup-login.sh"
  }

  provisioner "shell" {
    inline = ["echo \"${local.password}\" | sudo -S sh -c 'sh /tmp/setup-login.sh \"${local.username}\" \"${local.password}\"'"]
  }

  provisioner "file" {
    content = file("scripts/optimize-machine.sh")
    destination = "/tmp/optimize-machine.sh"
  }

  provisioner "shell" {
    inline = ["sudo sh /tmp/optimize-machine.sh"]
  }

  provisioner "shell" {
    inline = ["sudo rm -rf /tmp/*"]
  }
}
