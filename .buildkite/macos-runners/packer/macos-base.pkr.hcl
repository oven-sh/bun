packer {
  required_plugins {
    macstadium-orka = {
      version = ">= 3.0.0"
      source  = "github.com/macstadium/macstadium-orka"
    }
  }
}

variable "orka_endpoint" {
  description = "MacStadium Orka endpoint"
  type        = string
  default     = env("ORKA_ENDPOINT")
}

variable "orka_auth_token" {
  description = "MacStadium Orka auth token"
  type        = string
  default     = env("ORKA_AUTH_TOKEN")
  sensitive   = true
}

variable "base_image" {
  description = "Base macOS image to use"
  type        = string
  default     = "base-images/macos-15-sequoia"
}

variable "macos_version" {
  description = "macOS version (13, 14, 15)"
  type        = string
  default     = "15"
}

variable "cpu_count" {
  description = "Number of CPU cores"
  type        = number
  default     = 12
}

variable "memory_gb" {
  description = "Memory in GB"
  type        = number
  default     = 32
}

source "macstadium-orka" "base" {
  orka_endpoint   = var.orka_endpoint
  orka_auth_token = var.orka_auth_token
  
  source_image    = var.base_image
  image_name      = "bun-macos-${var.macos_version}-${formatdate("YYYY-MM-DD", timestamp())}"
  
  ssh_username    = "admin"
  ssh_password    = "admin"
  ssh_timeout     = "20m"
  
  vm_name         = "packer-build-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"
  cpu_count       = var.cpu_count
  memory_gb       = var.memory_gb
  
  # Enable GPU acceleration for better performance
  gpu_passthrough = true
  
  # Network configuration
  vnc_bind_address = "0.0.0.0"
  vnc_port_min     = 5900
  vnc_port_max     = 5999
  
  # Cleanup settings
  cleanup_pause_time = "30s"
  create_snapshot    = true
  
  # Boot wait time
  boot_wait = "2m"
}

build {
  sources = [
    "source.macstadium-orka.base"
  ]

  # Wait for SSH to be ready
  provisioner "shell" {
    inline = [
      "echo 'Waiting for system to be ready...'",
      "until ping -c1 google.com &>/dev/null; do sleep 1; done",
      "echo 'Network is ready'"
    ]
    timeout = "10m"
  }

  # Install Xcode Command Line Tools
  provisioner "shell" {
    inline = [
      "echo 'Installing Xcode Command Line Tools...'",
      "xcode-select --install || true",
      "until xcode-select -p &>/dev/null; do sleep 10; done",
      "echo 'Xcode Command Line Tools installed'"
    ]
    timeout = "30m"
  }

  # Copy and run bootstrap script
  provisioner "file" {
    source      = "${path.root}/../scripts/bootstrap-macos.sh"
    destination = "/tmp/bootstrap-macos.sh"
  }

  provisioner "shell" {
    inline = [
      "chmod +x /tmp/bootstrap-macos.sh",
      "sudo /tmp/bootstrap-macos.sh --ci"
    ]
    timeout = "60m"
  }

  # Install additional macOS-specific tools
  provisioner "shell" {
    inline = [
      "echo 'Installing additional macOS tools...'",
      "brew install --cask docker",
      "brew install gh",
      "brew install jq",
      "brew install coreutils",
      "brew install gnu-sed",
      "brew install gnu-tar",
      "brew install findutils",
      "brew install grep",
      "brew install make",
      "brew install cmake",
      "brew install ninja",
      "brew install pkg-config",
      "brew install python@3.11",
      "brew install python@3.12",
      "brew install go",
      "brew install rust",
      "brew install node",
      "brew install bun",
      "brew install wget",
      "brew install tree",
      "brew install htop",
      "brew install watch",
      "brew install tmux",
      "brew install screen"
    ]
    timeout = "30m"
  }

  # Install Buildkite agent
  provisioner "shell" {
    inline = [
      "echo 'Installing Buildkite agent...'",
      "brew install buildkite/buildkite/buildkite-agent",
      "sudo mkdir -p /usr/local/var/buildkite-agent",
      "sudo mkdir -p /usr/local/var/log/buildkite-agent",
      "sudo chown -R admin:admin /usr/local/var/buildkite-agent",
      "sudo chown -R admin:admin /usr/local/var/log/buildkite-agent"
    ]
    timeout = "10m"
  }

  # Copy user management scripts
  provisioner "file" {
    source      = "${path.root}/../scripts/"
    destination = "/tmp/scripts/"
  }

  provisioner "shell" {
    inline = [
      "sudo mkdir -p /usr/local/bin/bun-ci",
      "sudo cp /tmp/scripts/create-build-user.sh /usr/local/bin/bun-ci/",
      "sudo cp /tmp/scripts/cleanup-build-user.sh /usr/local/bin/bun-ci/",
      "sudo cp /tmp/scripts/job-runner.sh /usr/local/bin/bun-ci/",
      "sudo chmod +x /usr/local/bin/bun-ci/*.sh"
    ]
  }

  # Configure system settings for CI
  provisioner "shell" {
    inline = [
      "echo 'Configuring system for CI...'",
      "# Disable sleep and screensaver",
      "sudo pmset -a displaysleep 0 sleep 0 disksleep 0",
      "sudo pmset -a womp 1",
      "# Disable automatic updates",
      "sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled -bool false",
      "sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticDownload -bool false",
      "sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates -bool false",
      "# Increase file descriptor limits",
      "echo 'kern.maxfiles=1048576' | sudo tee -a /etc/sysctl.conf",
      "echo 'kern.maxfilesperproc=1048576' | sudo tee -a /etc/sysctl.conf",
      "# Enable core dumps",
      "sudo mkdir -p /cores",
      "sudo chmod 777 /cores",
      "echo 'kern.corefile=/cores/core.%P' | sudo tee -a /etc/sysctl.conf"
    ]
  }

  # Configure LaunchDaemon for Buildkite agent
  provisioner "shell" {
    inline = [
      "echo 'Configuring Buildkite LaunchDaemon...'",
      "sudo tee /Library/LaunchDaemons/com.buildkite.buildkite-agent.plist > /dev/null <<EOF",
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      "<plist version=\"1.0\">",
      "<dict>",
      "  <key>Label</key>",
      "  <string>com.buildkite.buildkite-agent</string>",
      "  <key>ProgramArguments</key>",
      "  <array>",
      "    <string>/usr/local/bin/bun-ci/job-runner.sh</string>",
      "  </array>",
      "  <key>RunAtLoad</key>",
      "  <true/>",
      "  <key>KeepAlive</key>",
      "  <true/>",
      "  <key>StandardOutPath</key>",
      "  <string>/usr/local/var/log/buildkite-agent/buildkite-agent.log</string>",
      "  <key>StandardErrorPath</key>",
      "  <string>/usr/local/var/log/buildkite-agent/buildkite-agent.error.log</string>",
      "  <key>EnvironmentVariables</key>",
      "  <dict>",
      "    <key>PATH</key>",
      "    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>",
      "  </dict>",
      "</dict>",
      "</plist>",
      "EOF"
    ]
  }

  # Clean up
  provisioner "shell" {
    inline = [
      "echo 'Cleaning up...'",
      "rm -rf /tmp/bootstrap-macos.sh /tmp/scripts/",
      "sudo rm -rf /var/log/*.log /var/log/*/*.log",
      "sudo rm -rf /tmp/* /var/tmp/*",
      "# Clean Homebrew cache",
      "brew cleanup --prune=all",
      "# Clean npm cache",
      "npm cache clean --force",
      "# Clean pip cache",
      "pip3 cache purge || true",
      "# Clean cargo cache",
      "cargo cache --remove-if-older-than 1d || true",
      "# Clean system caches",
      "sudo rm -rf /System/Library/Caches/*",
      "sudo rm -rf /Library/Caches/*",
      "rm -rf ~/Library/Caches/*",
      "echo 'Cleanup completed'"
    ]
  }

  # Final system preparation
  provisioner "shell" {
    inline = [
      "echo 'Final system preparation...'",
      "# Ensure proper permissions",
      "sudo chown -R admin:admin /usr/local/bin/bun-ci",
      "sudo chown -R admin:admin /usr/local/var/buildkite-agent",
      "sudo chown -R admin:admin /usr/local/var/log/buildkite-agent",
      "# Load the LaunchDaemon",
      "sudo launchctl load /Library/LaunchDaemons/com.buildkite.buildkite-agent.plist",
      "echo 'Image preparation completed'"
    ]
  }
}