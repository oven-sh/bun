#!/bin/sh

# A script that installs the dependencies needed to build and test Bun.
# This should work on macOS and Linux with a POSIX shell.

# If this script does not work on your machine, please open an issue:
# https://github.com/oven-sh/bun/issues

# If you need to make a change to this script, such as upgrading a dependency,
# increment the version number to indicate that a new image should be built.
# Otherwise, the existing image will be retroactively updated.
v="3"

pid=$$
script="$(realpath "$0")"

print() {
	echo "$@"
}

error() {
	echo "error: $@" >&2
	kill -s TERM "$pid"
	exit 1
}

execute() {
  print "$ $@" >&2
  if ! "$@"; then
    error "Command failed: $@"
  fi
}

execute_sudo() {
	if [ "$sudo" = "1" ]; then
		execute "$@"
	else
		execute sudo "$@"
	fi
}

execute_non_root() {
	if [ "$sudo" = "1" ]; then
		execute sudo -u "$user" "$@"
	else
		execute "$@"
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

download_file() {
  url="$1"
  filename="${2:-$(basename "$url")}"
  path="$(mktemp -d)/$filename"

  fetch "$url" > "$path"
  print "$path"
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

append_to_file() {
	file="$1"
	content="$2"

	if ! [ -f "$file" ]; then
		execute mkdir -p "$(dirname "$file")"
		execute touch "$file"
	fi

	echo "$content" | while read -r line; do
		if ! grep -q "$line" "$file"; then
			echo "$line" >> "$file"
		fi
	done
}

append_to_profile() {
	content="$1"
	profiles=".profile .zprofile .bash_profile .bashrc .zshrc"
	for profile in $profiles; do
		file="$HOME/$profile"
		if [ "$ci" = "1" ] || [ -f "$file" ]; then
			append_to_file "$file" "$content"
		fi
	done
}

append_to_path() {
	path="$1"
	if ! [ -d "$path" ]; then
		error "Could not find directory: \"$path\""
	fi

	append_to_profile "export PATH=\"$path:\$PATH\""
	export PATH="$path:$PATH"
}

check_system() {
	uname="$(require uname)"

	os="$($uname -s)"
	case "$os" in
	Linux*) os="linux" ;;
	Darwin*) os="darwin" ;;
	*) error "Unsupported operating system: $os" ;;
	esac

	arch="$($uname -m)"
	case "$arch" in
	x86_64 | x64 | amd64) arch="x64" ;;
	aarch64 | arm64) arch="aarch64" ;;
	*) error "Unsupported architecture: $arch" ;;
	esac

	kernel="$(uname -r)"

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
		if [ -n "$ID" ]; then
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

	if [ -n "$SUDO_USER" ]; then
		user="$SUDO_USER"
	else
		whoami="$(which whoami)"
		if [ -f "$whoami" ]; then
			user="$($whoami)"
		else
			error "Could not determine the current user, set \$USER."
		fi
	fi

	id="$(which id)"
	if [ -f "$id" ] && [ "$($id -u)" = "0" ]; then
		sudo=1
	fi

	if [ "$CI" = "true" ]; then
		ci=1
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
	if [ -n "$ci" ]; then
		print "| CI: true"
	fi
}

package_manager() {
	case "$pm" in
	apt) DEBIAN_FRONTEND=noninteractive \
		execute "$apt" "$@" ;;
	dnf) execute dnf "$@" ;;
	yum) execute "$yum" "$@" ;;
	brew)
    if ! [ -f "$(which brew)" ]; then
      install_brew
    fi
    execute_non_root brew "$@"
    ;;
	*) error "Unsupported package manager: $pm" ;;
	esac
}

update_packages() {
	case "$pm" in
	apt)
    package_manager update
    ;;
	esac
}

check_package() {
	case "$pm" in
	apt)
		apt-cache policy "$1"
		;;
	dnf | yum | brew)
		package_manager info "$1"
		;;
	*)
		error "Unsupported package manager: $pm"
		;;
	esac
}

install_packages() {
	case "$pm" in
	apt)
		package_manager install --yes --no-install-recommends "$@"
		;;
	dnf)
    package_manager install --assumeyes --nodocs --noautoremove --allowerasing "$@"
		;;
	yum)
		package_manager install -y "$@"
		;;
	brew)
		package_manager install --force --formula "$@"
    package_manager link --force --overwrite "$@"
		;;
	*)
		error "Unsupported package manager: $pm"
		;;
	esac
}

get_version() {
  command="$1"
  path="$(which "$command")"
  
  if [ -f "$path" ]; then
    case "$command" in
      go | zig) "$path" version ;;
      *) "$path" --version ;;
    esac
  else
    print "not found"
  fi
}

install_brew() {
  bash="$(require bash)"
  script=$(download_file "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh")
	NONINTERACTIVE=1 execute_non_root "$bash" "$script"

	case "$arch" in
	x64)
		append_to_path "/usr/local/bin"
		;;
	aarch64)
		append_to_path "/opt/homebrew/bin"
		;;
	esac

	case "$ci" in
	1)
		append_to_profile "export HOMEBREW_NO_INSTALL_CLEANUP=1"
		append_to_profile "export HOMEBREW_NO_AUTO_UPDATE=1"
		append_to_profile "export HOMEBREW_NO_ANALYTICS=1"
		;;
	esac
}

install_common_software() {
	case "$pm" in
	apt) install_packages \
		apt-transport-https \
		software-properties-common
    ;;
	dnf) install_packages \
		dnf-plugins-core \
		tar
    ;;
	esac

	install_packages \
		bash \
		ca-certificates \
		curl \
		jq \
		htop \
		gnupg \
		git \
		unzip \
		wget \
		zip

	install_rosetta
	install_nodejs
	install_bun
}

install_nodejs() {
	version="${1:-"22"}"

	if ! [ "$(compare_version "$glibc" "2.27")" = "1" ]; then
		version="16"
	fi

	case "$pm" in
	dnf | yum)
    bash="$(require bash)"
    script=$(download_file "https://rpm.nodesource.com/setup_$version.x")
    execute "$bash" "$script"
		;;
	apt)
    bash="$(require bash)"
    script=$(download_file "https://deb.nodesource.com/setup_$version.x")
    execute "$bash" "$script"
		;;
	esac

	install_packages nodejs
}

install_bun() {
  bash="$(require bash)"
  script=$(download_file "https://bun.sh/install")

  version="${1:-"latest"}"
	case "$version" in
	latest)
    execute "$bash" "$script"
		;;
	*)
    execute "$bash" "$script" -s "$version"
		;;
	esac

	append_to_path "$HOME/.bun/bin"
}

install_rosetta() {
	case "$os" in
	darwin)
		if ! [ "$(which arch)" ]; then
			execute softwareupdate \
				--install-rosetta \
				--agree-to-license
		fi
		;;
	esac
}

install_build_essentials() {
	case "$pm" in
	apt) install_packages \
		build-essential \
		ninja-build \
		xz-utils
    ;;
	dnf | yum) install_packages \
		ninja-build \
		gcc-c++ \
		xz
    ;;
	brew) install_packages \
		ninja
    ;;
	esac

	install_packages \
		make \
		cmake \
		pkg-config \
		python3 \
		libtool \
		ruby \
		perl \
		golang

	install_llvm
	install_ccache
	install_rust
	install_docker
}

llvm_version_exact() {
  case "$os" in
  linux)
    print "16.0.6"
    ;;
  darwin | windows)
    print "18.1.8"
    ;;
  esac
}

llvm_version() {
  echo "$(llvm_version_exact)" | cut -d. -f1
}

install_llvm() {
	case "$pm" in
	apt)
    bash="$(require bash)"
    script=$(download_file "https://apt.llvm.org/llvm.sh")
		execute "$bash" "$script" "$(llvm_version)" all
		;;
  brew)
    install_packages "llvm@$(llvm_version)"
    ;;
  *)
    compile_llvm
    ;;
	esac
}

compile_llvm() {
  return # TODO

  version="$(llvm_version_exact)"
  src="$(mktemp -d)/llvm-$version"
  build="$src/build"

  git="$(require git)"
  execute "$git" clone \
    --depth 1 \
    --branch "llvmorg-$version" \
    --single-branch \
    https://github.com/llvm/llvm-project.git "$src"

  cmake="$(require cmake)"
  execute "$cmake" \
    -S "$src/llvm" \
    -B "$build" \
    -DCMAKE_BUILD_TYPE=Release
  execute "$cmake" \
    --build "$build" \
    --target install
}

install_ccache() {
  case "$pm" in
  apt | brew)
    install_packages ccache
    ;;
  *)
    compile_ccache
    ;;
  esac
}

compile_ccache() {
  return # TODO

  src="$(mktemp -d)/ccache"
  build="$src/build"

  git="$(require git)"
  execute "$git" clone \
    --depth 1 \
    --single-branch \
    https://github.com/ccache/ccache.git "$src"

  cmake="$(require cmake)"
  execute "$cmake" \
    -S "$src" \
    -B "$build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DENABLE_TESTING=OFF \
    -DREDIS_STORAGE_BACKEND=OFF \
    -DSTATIC_LINK=ON
  execute "$cmake" \
    --build "$build" \
    --target install
}

install_rust() {
  sh="$(require sh)"
  script=$(download_file "https://sh.rustup.rs")
  execute "$sh" "$script" -y
	append_to_path "$HOME/.cargo/bin"
}

install_docker() {
	case "$pm" in
	brew)
    if ! [ -d "/Applications/Docker.app" ]; then
		  package_manager install docker --cask
    fi
		;;
	*)
    case "$distro-$release" in
    amzn-2 | amzn-1)
      execute amazon-linux-extras install docker
      ;;
    amzn-*)
      install_packages docker
      ;;
    *)
      sh="$(require sh)"
      script=$(download_file "https://get.docker.com")
      execute "$sh" "$script"
		  ;;
    esac
    ;;
	esac

  systemctl="$(which systemctl)"
  if [ -f "$systemctl" ]; then
    execute "$systemctl" enable docker
  fi
}

install_ci_dependencies() {
	if ! [ "$ci" = "1" ]; then
		return
	fi

	install_tailscale
	install_buildkite
}

install_tailscale() {
	case "$os" in
	linux)
    sh="$(require sh)"
    script=$(download_file "https://tailscale.com/install.sh")
    execute "$sh" "$script"
		;;
	darwin)
		install_packages go
		execute_non_root go install tailscale.com/cmd/tailscale{,d}@latest
		append_to_path "$HOME/go/bin"
		;;
	esac
}

install_buildkite() {
	home_dir="/var/lib/buildkite-agent"
	config_dir="/etc/buildkite-agent"
	config_file="$config_dir/buildkite-agent.cfg"

	if ! [ -d "$home_dir" ]; then
		execute_sudo mkdir -p "$home_dir"
	fi

	if ! [ -d "$config_dir" ]; then
		execute_sudo mkdir -p "$config_dir"
	fi

	case "$os" in
	linux)
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

		execute chown -R buildkite-agent:buildkite-agent "$home_dir"
		execute chown -R buildkite-agent:buildkite-agent "$config_dir"
		;;
	darwin)
		execute_sudo chown -R "$user:admin" "$home_dir"
		execute_sudo chown -R "$user:admin" "$config_dir"
		;;
	esac

	if ! [ -f "$config_file" ]; then
		cat <<EOF >"$config_file"
# This is generated by scripts/bootstrap.sh
# https://buildkite.com/docs/agent/v3/configuration

name="%hostname-%random"
tags="v=$v,os=$os,arch=$arch,distro=$distro,release=$release,kernel=$kernel,glibc=$glibc"

build-path="$home_dir/builds"
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

	bash="$(require bash)"
	script=$(download_file "https://raw.githubusercontent.com/buildkite/agent/main/install.sh")
	execute "$bash" "$script"

	out_dir="$HOME/.buildkite-agent"
	execute_sudo mv -f "$out_dir/bin/buildkite-agent" "/usr/local/bin/buildkite-agent"
	execute rm -rf "$out_dir"
}

install_chrome_dependencies() {
	# https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#chrome-doesnt-launch-on-linux
	# https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-in-the-cloud
	case "$pm" in
	apt)
		install_packages \
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
	dnf | yum)
		install_packages \
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

main() {
  check_system
  update_packages
  install_common_software
  install_build_essentials
  install_chrome_dependencies
  install_ci_dependencies
}

main
