// Linux (debian-13) build image for local dev (docker) and CI (AWS AMI).
// Both builders run the same scripts/bootstrap.sh provisioner so the two
// environments stay in lock-step.
//
// Shared variables (repo_ref, bootstrap_script, agent_script, image_name,
// build_number) live in variables.pkr.hcl — `packer init`/`build` is invoked
// on the whole directory (see scripts/machine.mjs), so redeclaring them here
// would be a duplicate-variable error.

packer {
  required_plugins {
    docker = {
      source  = "github.com/hashicorp/docker"
      version = ">= 1.0.0"
    }
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = ">= 1.3.0"
    }
  }
}

variable "arch" {
  type        = string
  default     = "x64"
  description = "Target architecture: x64 or aarch64."
  validation {
    condition     = contains(["x64", "aarch64"], var.arch)
    error_message = "The arch variable must be one of: x64, aarch64."
  }
}

variable "ci" {
  type        = bool
  default     = true
  description = "Pass --ci to bootstrap.sh (installs buildkite-agent, sysroots, prefetch cache)."
}

variable "version" {
  type        = string
  default     = "0"
  description = "Bootstrap version (the `# Version:` comment in scripts/bootstrap.sh). Used in the AMI name / docker tag."
}

variable "region" {
  type        = string
  default     = env("AWS_REGION") != "" ? env("AWS_REGION") : "us-east-1"
  description = "AWS region for the amazon-ebs builder."
}

variable "instance_type" {
  type        = string
  default     = ""
  description = "EC2 instance type for the bake VM. Empty => derived from arch."
}

variable "root_volume_size" {
  type        = number
  default     = 64
  description = "Root EBS volume size in GiB (xfs, gp3)."
}

locals {
  // Debian Cloud Team AMIs (owner 136693071363) use amd64/arm64 in the Name;
  // EC2's architecture filter wants x86_64/arm64.
  debian_name_arch = var.arch == "aarch64" ? "arm64" : "amd64"
  ec2_arch         = var.arch == "aarch64" ? "arm64" : "x86_64"
  // c7i for x64, c7g for Graviton — build-only VM, not the CI runner size.
  instance_type    = var.instance_type != "" ? var.instance_type : (var.arch == "aarch64" ? "c7g.2xlarge" : "c7i.2xlarge")
  // Matches getImageKey()+getImageName() in .buildkite/ci.mjs when called
  // with {os:"linux", arch, distro:"debian", release:"13"} under publish:
  //   "linux-<arch>-13-debian-v<bootstrapVersion>"
  // image_name (from variables.pkr.hcl) overrides for [build images] runs.
  ami_name         = var.image_name != "" ? var.image_name : "linux-${var.arch}-13-debian-v${var.version}"
  ci_flag          = var.ci ? "--ci" : ""
}

// ---------------------------------------------------------------------------
// Docker: local-dev image. Same bootstrap as the AMI so `docker run` matches
// what CI sees. `commit=true` => the provisioned container is committed to an
// image; the docker-tag post-processor names it.
// ---------------------------------------------------------------------------
source "docker" "debian" {
  image    = "debian:13-slim"
  platform = "linux/${local.debian_name_arch}"
  commit   = true
  changes = [
    "LABEL org.opencontainers.image.source=https://github.com/oven-sh/bun",
    "LABEL sh.bun.bootstrap.version=${var.version}",
    "ENV CI=true",
    "ENV DEBIAN_FRONTEND=noninteractive",
  ]
}

// ---------------------------------------------------------------------------
// AWS: CI AMI. Filters the latest official debian-13 cloud image for the
// requested arch, bakes on a gp3/xfs root volume.
// ---------------------------------------------------------------------------
source "amazon-ebs" "debian" {
  region        = var.region
  instance_type = local.instance_type
  ssh_username  = "admin"

  ami_name        = local.ami_name
  ami_description = "Bun CI build image (debian-13, ${var.arch}, bootstrap v${var.version})"
  force_deregister      = true
  force_delete_snapshot = true

  source_ami_filter {
    filters = {
      name                = "debian-13-${local.debian_name_arch}-*"
      architecture        = local.ec2_arch
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    owners      = ["136693071363"] // Debian Cloud Team
    most_recent = true
  }

  // Root volume on gp3. Debian cloud AMIs expose root as /dev/xvda.
  // NOTE: the Debian base AMI ships an ext4 root; an xfs ROOT needs a
  // rebased AMI or a separate data volume. For now we attach a second gp3
  // volume that bootstrap can mkfs.xfs and mount for /var/lib/buildkite —
  // revisit once a debian-13-xfs base exists.
  launch_block_device_mappings {
    device_name           = "/dev/xvda"
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    delete_on_termination = true
  }
  launch_block_device_mappings {
    device_name           = "/dev/xvdb"
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    delete_on_termination = true
  }
  user_data = <<-EOF
    #cloud-config
    fs_setup:
      - device: /dev/xvdb
        filesystem: xfs
        label: build
    mounts:
      - ["/dev/xvdb", "/var/lib/buildkite-agent", "xfs", "defaults,nofail", "0", "2"]
  EOF

  tags = {
    Name   = local.ami_name
    os     = "linux"
    arch   = var.arch
    distro = "debian"
    build  = var.build_number
  }
}

build {
  name    = "linux-debian-13"
  sources = [
    "source.docker.debian",
    "source.amazon-ebs.debian",
  ]

  // debian:13-slim has no curl/sudo/ca-certs; bootstrap.sh's fetch() needs
  // curl-or-wget before install_common_software runs. The Debian AMI already
  // has these, but a second `apt-get install` is a no-op there.
  provisioner "shell" {
    environment_vars = ["DEBIAN_FRONTEND=noninteractive"]
    inline = [
      "set -eu",
      "if command -v sudo >/dev/null 2>&1; then SUDO=sudo; else SUDO=; fi",
      "$SUDO apt-get update -y",
      "$SUDO apt-get install -y --no-install-recommends ca-certificates curl sudo",
    ]
  }

  // Upload bootstrap.sh (path comes from -var bootstrap_script=..., see
  // machine.mjs; default in variables.pkr.hcl is the .ps1 — caller must
  // override for this template).
  provisioner "file" {
    source      = var.bootstrap_script
    destination = "/tmp/bootstrap.sh"
  }

  // Run bootstrap. docker runs as root (no sudo); amazon-ebs runs as `admin`
  // with passwordless sudo. `-E` preserves BUN_BOOTSTRAP_REPO_REF across the
  // sudo boundary so prefetch_build_deps() clones the right ref.
  provisioner "shell" {
    environment_vars = [
      "BUN_BOOTSTRAP_REPO_REF=${var.repo_ref}",
      "DEBIAN_FRONTEND=noninteractive",
    ]
    execute_command = "chmod +x {{ .Path }}; if command -v sudo >/dev/null 2>&1 && [ \"$(id -u)\" -ne 0 ]; then sudo -E sh -c '{{ .Vars }} {{ .Path }}'; else {{ .Vars }} sh '{{ .Path }}'; fi"
    inline = [
      "set -eu",
      "sh /tmp/bootstrap.sh ${local.ci_flag}",
    ]
  }

  // Optional: install agent.mjs as a service. Skipped when agent_script is
  // empty (local docker dev image). Mirrors the Windows templates' step 2/3.
  provisioner "file" {
    only        = ["amazon-ebs.debian"]
    source      = var.agent_script
    destination = "/tmp/agent.mjs"
  }
  provisioner "shell" {
    only   = ["amazon-ebs.debian"]
    inline = [
      "set -eu",
      "if [ -s /tmp/agent.mjs ]; then",
      "  sudo mkdir -p /var/lib/buildkite-agent",
      "  sudo cp /tmp/agent.mjs /var/lib/buildkite-agent/agent.mjs",
      "  sudo $(command -v node || command -v bun) /var/lib/buildkite-agent/agent.mjs install",
      "fi",
    ]
  }

  // Tag the committed docker image so `docker run oven/bun-build:<name>` works.
  post-processor "docker-tag" {
    only       = ["docker.debian"]
    repository = "oven/bun-build"
    tags       = [local.ami_name, "debian-13-${var.arch}"]
  }
}
