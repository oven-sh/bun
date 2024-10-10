#!/bin/sh

# A script to setup a machine to build or test Bun.
# This should work on macOS and Linux, with support for most Linux distros.

pid=$$

print() {
  echo "$*"
}

error() {
  echo "error: $*" >&2
  kill -s TERM "$pid"
  exit 1
}

execute() {
  print "$ $*"
  if ! $*; then
    error "Command failed: $*"
  fi
}

execute_non_root() {
  if [ "$sudo" = "1" ]; then
    execute sudo -u "$user" $*
  else
    execute $*
  fi
}

which() {
  command -v "$1"
}

require() {
  path="$(which "$1")"
  if ! [ -f "$path" ]; then
    error "Command \"$1\" is required, but is not installed."
  fi
  echo "$path"
}

fetch() {
  curl=$(which curl)
  if [ -f "$curl" ]; then
    execute "$curl" -fsSL "$1"
  else
    wget=$(which wget)
    if [ -f "$wget" ]; then
      execute "$wget" -qO- "$1"
    else
      error "Command \"curl\" or \"wget\" is required, but is not installed."
    fi
  fi
}

compare_version() {
  if [ "$1" = "$2" ]; then
    echo "0"
  elif [ "$1" = "$(echo -e "$1\n$2" | sort -V | head -n1)" ]; then
    echo "-1"
  else
    echo "1"
  fi
}

move_to_bin() {
  bin="$1"

  if ! [ -d "$bin" ]; then
    error "Could not find directory: \"$bin\""
  fi

  mv $bin/* /usr/bin/
}

check_system() {
  uname="$(require uname)"

  os="$($uname -s)"
  case "$os" in
    Linux*) os="linux" ;;
    Darwin*) os="darwin" ;;
    CYGWIN* | MINGW32* | MSYS* | MINGW*) os="windows" ;;
    *) error "Unsupported operating system: $os" ;;
  esac

  arch="$($uname -m)"
  case "$arch" in
    x86_64 | x64 | amd64)  arch="x64" ;;
    aarch64 | arm64) arch="aarch64" ;;
    *) error "Unsupported architecture: $arch" ;;
  esac
  
  if [ "$os" = "darwin" ]; then
    sw_vers="$(which sw_vers)"
    if [ -f "$sw_vers" ]; then
      distro="$($sw_vers -productName)"
      release="$($sw_vers -productVersion)"
    fi

    if [ "$arch" = "x64" ]; then
      sysctl="$(which sysctl)"
      if [ -f "$sysctl" ] && [ "$($sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
        arch="aarch64"
        rosetta="1"
      fi
    fi
  fi

  if [ "$os" = "linux" ] && [ -f /etc/os-release ]; then
    . /etc/os-release
    if [ -n "$NAME" ]; then
      distro="$NAME"
    elif [ -n "$ID" ]; then
      distro="$ID"
    fi
    if [ -n "$VERSION_ID" ]; then
      release="$VERSION_ID"
    fi
  fi

  if [ "$os" = "linux" ]; then
    rpm="$(which rpm)"
    if [ -f "$rpm" ]; then
      glibc="$($rpm -q glibc --queryformat '%{VERSION}\n')"
    else
      ldd="$(which ldd)"
      awk="$(which awk)"
      if [ -f "$ldd" ] && [ -f "$awk" ]; then
        glibc="$($ldd --version | $awk 'NR==1{print $NF}')"
      fi
    fi
  fi

  if [ "$os" = "darwin" ]; then
    brew="$(which brew)"
    if ! [ -f "$brew" ]; then
      install_brew
    fi
    brew="$(require brew)"
    pm="brew"
  fi

  if [ "$os" = "linux" ]; then
    apt="$(which apt-get)"
    if [ -f "$apt" ]; then
      pm="apt"
    else
      dnf="$(which dnf)"
      if [ -f "$dnf" ]; then
        pm="dnf"
      else
        yum="$(which yum)"
        if [ -f "$yum" ]; then
          pm="yum"
        fi
      fi
    fi
    
    if [ -z "$pm" ]; then
      error "No package manager found. (apt, dnf, yum)"
    fi
  fi

  whoami="$(which whoami)"
  if [ -f "$whoami" ]; then
    user="$($whoami)"
  elif [ -n "$USER" ]; then
    user="$USER"
  else
    error "Could not determine the current user, set \$USER or ensure the \"whoami\" command is installed."
  fi

  id="$(which id)"
  if [ -f "$id" ] && [ "$($id -u)" = "0" ]; then
    sudo=1
  elif [ "$EUID" = "0" ]; then
    sudo=1
  fi

  print "System information:"
  if [ -n "$distro" ]; then
    print "| Distro: $distro $release"
  fi
  print "| Operating system: $os"
  print "| Architecture: $arch"
  if [ -n "$rosetta" ]; then
    print "| Rosetta: true"
  fi
  if [ -n "$glibc" ]; then
    print "| Glibc: $glibc"
  fi
  print "| Package manager: $pm"
  print "| User: $user"
  if [ -n "$sudo" ]; then
    print "| Sudo: true"
  fi
}

package_manager() {
  case "$pm" in
    apt) execute "$apt" $* ;;
    dnf) execute "$dnf" $* ;;
    yum) execute "$yum" $* ;;
    brew) execute_non_root \
      HOMEBREW_NO_INSTALL_CLEANUP=1 \
      HOMEBREW_NO_AUTO_UPDATE=1 \
      HOMEBREW_NO_ANALYTICS=1 \
      "$brew" $* ;;
    *) error "Unsupported package manager: $pm" ;;
  esac
}

update_packages() {
  case "$pm" in
    apt) execute "$apt" update ;;
  esac
}

check_package() {
  case "$pm" in
    apt) command="apt-cache policy $1" ;;
    dnf) command="$dnf info $1" ;;
    yum) command="$yum info $1" ;;
    brew) command="$brew info $1" ;;
    *) error "Unsupported package manager: $pm" ;;
  esac

  $command
}

install_packages() {
  case "$pm" in
    apt) args="install --yes --no-install-recommends" ;;
    dnf) args="install --assumeyes --nodocs --noautoremove --allowerasing" ;;
    yum) args="install -y" ;;
    brew) args="install --force" ;;
    *) error "Unsupported package manager: $pm" ;;
  esac

  package_manager "$args" "$@"
}

install_brew() {
  fetch "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh" \
    | exec_non_root NONINTERACTIVE=1 bash
}

install_common_software() {
  case "$pm" in
    apt) install_packages \
      apt-transport-https \
      software-properties-common ;;
    dnf) install_packages \
      dnf-plugins-core ;;
  esac

  install_packages \
    ca-certificates \
    curl \
    bash \
    gnupg \
    git \
    unzip \
    tar \
    zip

  install_nodejs
  install_bun
}

install_nodejs() {
  version="${1:-"22"}"

  if ! [ "$(compare_version "$glibc" "2.27")" = "1" ]; then
    version="16"
  fi

  case "$pm" in
    dnf | yum) fetch "https://rpm.nodesource.com/setup_$version.x" | bash ;;
    apt) fetch "https://deb.nodesource.com/setup_$version.x" | bash ;;
  esac

  install_packages nodejs
}

install_bun() {
  bash="$(require bash)"
  version="${1:-"latest"}"

  if [ "$version" = "latest" ]; then
    fetch "https://bun.sh/install" | "$bash"
  else
    fetch "https://bun.sh/install" | "$bash" -s "$version"
  fi

  move_to_bin "$HOME/.bun/bin"
}

install_build_essentials() {
  case "$pm" in
    apt) install_packages \
      build-essential \
      ccache \
      xz-utils ;;
    dnf | yum) install_packages \
      gcc-c++ \
      xz ;;
  esac

  install_packages \
    make \
    cmake \
    ninja-build \
    pkg-config \
    python3 \
    libtool \
    ruby \
    perl \
    golang

  install_llvm
  install_rust
  install_docker
}

install_llvm() {
  version="${1:-"16"}"

  case "$pm" in
    apt) fetch "https://apt.llvm.org/llvm.sh" | bash -s -- "$version" all ;;
  esac
}

install_rust() {
  fetch "https://sh.rustup.rs" | sh -s -- -y
  move_to_bin "$HOME/.cargo/bin"
}

install_docker() {
  fetch "https://get.docker.com" | sh
}

install_ci_dependencies() {
  install_tailscale
  install_buildkite
}

install_tailscale() {
  fetch "https://tailscale.com/install.sh" | sh
}

install_buildkite() {
  case "$os" in
    linux) install_buildkite_linux ;;
    darwin) install_packages \
      buildkite/buildkite/buildkite-agent ;;
  esac
}

install_buildkite_linux() {
  home_dir="/var/lib/buildkite-agent"
  config_dir="/etc/buildkite-agent"
  config_file="$config_dir/buildkite-agent.cfg"

  getent="$(require getent)"
  if [ -z "$("$getent" passwd buildkite-agent)" ]; then
    useradd="$(require useradd)"
    execute "$useradd" buildkite-agent \
      --system \
      --no-create-home \
      --home-dir "$home_dir"
  fi

  if [ -n "$("$getent" group docker)" ]; then
    usermod="$(require usermod)"
    execute "$usermod" -aG docker buildkite-agent
  fi

  if ! [ -d "$home_dir" ]; then
    execute mkdir -p "$home_dir"
  fi

  if ! [ -d "$config_dir" ]; then
    execute mkdir -p "$config_dir"
  fi

  if ! [ -f "$config_file" ]; then
    cat << EOF > "$config_file"
# This is generated by scripts/bootstrap.sh
# https://buildkite.com/docs/agent/v3/configuration
token="xxx"

name="%hostname-%pid"
spawn=1
tags="os=$os,arch=$arch,distro=$distro,release=$release,glibc=$glibc"

build-path="$home_dir"
git-mirrors-path="$home_dir/git"
job-log-path="$home_dir/logs"
plugins-path="$config_dir/plugins"
hooks-path="$config_dir/hooks"

no-ssh-keyscan=true
cancel-grace-period=3600000 # 1 hour
enable-job-log-tmpfile=true
experiment="normalised-upload-paths,resolve-commit-after-checkout,agent-api"
EOF
  fi

  agent="$(which buildkite-agent)"
  if ! [ -f "$agent" ]; then
    bash="$(require bash)"
    fetch "https://raw.githubusercontent.com/buildkite/agent/main/install.sh" | "$bash"
    
    out_dir="$HOME/.buildkite-agent"
    move_to_bin "$out_dir/bin"
    execute rm -rf "$out_dir"
  fi

  agent="$(require buildkite-agent)"
  systemctl="$(which systemctl)"
  if [ -f "$systemctl" ]; then
    service_file="/etc/systemd/system/buildkite-agent.service"
    if ! [ -f "$service_file" ]; then
      cat << EOF > "$service_file"
# This is generated by scripts/bootstrap.sh
# https://buildkite.com/docs/agent/v3/configuration

[Unit]
Description=Buildkite Agent
Documentation=https://buildkite.com/agent
After=syslog.target
After=network.target

[Service]
Type=simple
User=buildkite-agent
Environment=HOME=$home_dir
ExecStart=$agent start 
RestartSec=5
Restart=on-failure
RestartForceExitStatus=SIGPIPE
TimeoutStartSec=10
TimeoutStopSec=0
KillMode=process

[Install]
WantedBy=multi-user.target
EOF
    fi
  fi

  execute chown -R buildkite-agent:buildkite-agent "$home_dir"
  execute chown -R buildkite-agent:buildkite-agent "$config_dir"
}

install_chrome_dependencies() {
  # https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#chrome-doesnt-launch-on-linux
  # https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-in-the-cloud
  case "$pm" in
    apt) install_packages \
      fonts-liberation \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libc6 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libgcc1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libstdc++6 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      xdg-utils
      
      # Fixes issue in newer version of Ubuntu: 
      # Package 'libasound2' has no installation candidate
      if [ "$(check_package "libasound2t64")" ]; then
        install_packages libasound2t64
      else
        install_packages libasound2
      fi
      ;;
    dnf | yum) install_packages \
      alsa-lib \
      atk \
      cups-libs \
      gtk3 \
      ipa-gothic-fonts \
      libXcomposite \
      libXcursor \
      libXdamage \
      libXext \
      libXi \
      libXrandr \
      libXScrnSaver \
      libXtst \
      pango \
      xorg-x11-fonts-100dpi \
      xorg-x11-fonts-75dpi \
      xorg-x11-fonts-cyrillic \
      xorg-x11-fonts-misc \
      xorg-x11-fonts-Type1 \
      xorg-x11-utils
      ;;
  esac
}

check_system
update_packages
install_common_software
install_build_essentials
install_chrome_dependencies
install_ci_dependencies
