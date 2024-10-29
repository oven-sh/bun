#!/bin/sh

# A script that installs the dependencies needed to build and test Bun.
# This should work on macOS and Linux with a POSIX shell.

# If this script does not work on your machine, please open an issue:
# https://github.com/oven-sh/bun/issues

# If you need to make a change to this script, such as upgrading a dependency,
# increment the version number, `v`, to indicate that a new image should be built.
# Otherwise, the existing image will be retroactively updated.

# curl -fsSL "https://raw.githubusercontent.com/oven-sh/bun/refs/heads/main/scripts/bootstrap.sh" | CI=true sh

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

execute_as_user() {
	if [ "$sudo" = "1" ] && [ -n "$user" ]; then
		if [ -f "$(which sudo)" ]; then
			execute sudo -u "$user" "$@"
		elif [ -f "$(which su)" ]; then
			execute su -s /bin/sh "$user" -c "$*"
		else
			execute /bin/sh -c "$*"
		fi
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
	tmp="$(execute_as_user mktemp -d)"
	path="$tmp/$filename"

	fetch "$url" >"$path"
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
		execute_as_user mkdir -p "$(dirname "$file")"
		execute_as_user touch "$file"
	fi

	echo "$content" | while read -r line; do
		if ! grep -q "$line" "$file"; then
			echo "$line" >>"$file"
		fi
	done
}

append_to_profile() {
	content="$1"
	profiles=".profile .zprofile .bash_profile .bashrc .zshrc"
	for profile in $profiles; do
		file="$home/$profile"
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

	append_to_profile "export PATH=\"\$PATH\":$path"
	export PATH="$PATH:$path"
}

link_to_bin() {
	path="$1"
	if ! [ -d "$path" ]; then
		error "Could not find directory: \"$path\""
	fi

	for file in "$path"/*; do
		if [ -f "$file" ]; then
			execute_sudo ln -sf "$file" "/usr/bin/$(basename "$file")"
		fi
	done
}

check_features() {
	print "Checking features..."

	if [ "$CI" = "true" ] || [ "$CI" = "1" ]; then
		ci=1
		print "CI: enabled"
	fi
}

check_operating_system() {
	print "Checking operating system..."
	uname="$(require uname)"

	os="$($uname -s)"
	case "$os" in
	Linux*) os="linux" ;;
	Darwin*) os="darwin" ;;
	*) error "Unsupported operating system: $os" ;;
	esac
	print "Operating system: $os"

	arch="$($uname -m)"
	case "$arch" in
	x86_64 | x64 | amd64) arch="x64" ;;
	aarch64 | arm64) arch="aarch64" ;;
	*) error "Unsupported architecture: $arch" ;;
	esac
	print "Architecture: $arch"

	if [ -f "/.dockerenv" ]; then
		docker=1
	else
		if [ -f "/proc/1/cgroup" ]; then
			case "$(cat /proc/1/cgroup)" in
			*/docker/*)
				docker=1
				;;
			esac
		fi

		if [ -f "/proc/self/mountinfo" ]; then
			case "$(cat /proc/self/mountinfo)" in
			*/docker/*)
				docker=1
				;;
			esac
		fi
	fi

	if [ "$docker" = "1" ]; then
		print "Docker: enabled"
	fi

	kernel="$(uname -r)"
	print "Kernel: $kernel"

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

			if [ "$distro" = "alpine" ]; then
				if [ "$(echo $release | grep -c '_')" = "1" ]; then
					release="edge"
				fi
			fi
		fi
	fi

	if [ -n "$distro" ]; then
		print "Distribution: $distro $release"
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

	if [ -n "$glibc" ]; then
		print "Glibc: $glibc"
	fi
}

check_package_manager() {
	print "Checking package manager..."

	case "$os" in
	darwin)
		if ! [ -f "$(which brew)" ]; then
			install_brew
		fi
		pm="brew"
		;;
	linux)
		if [ -f "$(which apt-get)" ]; then
			pm="apt"
		elif [ -f "$(which dnf)" ]; then
			pm="dnf"
		elif [ -f "$(which yum)" ]; then
			pm="yum"
		else
			error "No package manager found. (apt, dnf, yum)"
		fi
		;;
	esac

	print "Package manager: $pm"

	case "$pm" in
	apt)
		package_manager update -y
		;;
	esac
}

check_user() {
	print "Checking user..."

	if [ "$ci" = "1" ] && [ "$os" = "linux" ] && [ -z "$docker" ]; then
		create_buildkite_user
	elif [ -n "$SUDO_USER" ]; then
		user="$SUDO_USER"
	else
		whoami="$(require whoami)"
		user="$($whoami)"
	fi
	print "User: $user"

	id="$(which id)"
	if [ -f "$id" ] && [ "$($id -u)" = "0" ]; then
		sudo=1
		print "Sudo: enabled"
	fi

	home="$(execute_as_user echo '$HOME')"
	if [ -z "$home" ]; then
		error "Could not determine home directory for user: $user"
	fi
	print "Home: $home"
}

package_manager() {
	case "$pm" in
	apt)
		DEBIAN_FRONTEND=noninteractive execute apt-get "$@"
		;;
	dnf)
		execute dnf "$@"
		;;
	yum)
		execute yum "$@"
		;;
	brew)
		execute_as_user brew "$@"
		;;
	*)
		error "Unsupported package manager: $pm"
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
	apk)
		package_manager add "$@"
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
	print "Installing Homebrew..."

	bash="$(require bash)"
	script=$(download_file "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh")
	NONINTERACTIVE=1 execute_as_user "$bash" "$script"

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
	apt)
		install_packages \
			apt-transport-https \
			software-properties-common
		;;
	dnf)
		install_packages \
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
	install_tailscale
	install_buildkite
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
	if [ "$os" = "linux" ] && [ "$distro" = "alpine" ] && [ "$arch" = "aarch64" ]; then
		mkdir -p "$HOME/.bun/bin"
		wget -O "$HOME/.bun/bin/bun" https://pub-61e0d0e2da4146a099e4545a59a9f0f7.r2.dev/bun-musl-arm64
		chmod +x "$HOME/.bun/bin/bun"
		append_to_path "$HOME/.bun/bin"
		return
	fi
	
  bash="$(require bash)"
  script=$(download_file "https://bun.sh/install")

	version="${1:-"latest"}"
	case "$version" in
	latest)
		execute_as_user "$bash" "$script"
		;;
	*)
		execute_as_user "$bash" "$script" -s "$version"
		;;
	esac

	link_to_bin "$home/.bun/bin"
}

install_cmake() {
	case "$os" in
	darwin)
		install_packages cmake
		;;
	linux)
		sh="$(require sh)"
		release="3.30.5"
		case "$arch" in
		x64)
			url="https://github.com/Kitware/CMake/releases/download/v$release/cmake-$release-linux-x86_64.sh"
			;;
		aarch64)
			url="https://github.com/Kitware/CMake/releases/download/v$release/cmake-$release-linux-aarch64.sh"
			;;
		esac
		script=$(download_file "$url")
		execute "$sh" "$script" \
			--skip-license \
			--prefix=/usr
		;;
	esac
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
	apt)
		install_packages \
			build-essential \
			ninja-build \
			xz-utils \
			pkg-config \
			golang
    ;;
	dnf | yum)
		install_packages \
			ninja-build \
			gcc-c++ \
			xz \
			pkg-config \
			golang
    ;;
	brew)
		install_packages \
			ninja \
			pkg-config \
			golang
    ;;
	apk)
		install_packages \
			ninja \
			xz
    ;;
	esac

	case "$distro-$pm" in
	amzn-dnf)
		package_manager groupinstall -y "Development Tools"
		;;
	esac

	install_packages \
		make \
		python3 \
		libtool \
		ruby \
		perl

	install_cmake
	install_llvm
	install_ccache
	install_rust
	install_docker
}

llvm_version_exact() {
	if [ "$os" = "linux" ] && [ "$distro" = "alpine" ]; then
		print "18.1.8"
		return
	fi
	
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
		script="$(download_file "https://apt.llvm.org/llvm.sh")"
		execute "$bash" "$script" "$(llvm_version)" all
		;;
  brew)
    install_packages "llvm@$(llvm_version)"
    ;;
  apk)
    install_packages \
			"llvm$(llvm_version)-dev" \
			"clang$(llvm_version)-dev" \
			"lld$(llvm_version)-dev"
    ;;
	esac
}

install_ccache() {
	case "$pm" in
	apt | brew)
		install_packages ccache
		;;
	esac
}

install_rust() {
	if [ "$os" = "linux" ] && [ "$distro" = "alpine" ]; then
		install_packages rust cargo
		mkdir -p "$HOME/.cargo/bin"
		append_to_path "$HOME/.cargo/bin"
		return
	fi

  sh="$(require sh)"
  script=$(download_file "https://sh.rustup.rs")
	execute_as_user "$sh" "$script" -y

	# FIXME: This causes cargo to fail to build:
	# > error: rustup could not choose a version of cargo to run,
	# > because one wasn't specified explicitly, and no default is configured.
	# link_to_bin "$home/.cargo/bin"
}

install_docker() {
	if [ "$docker" = "1" ]; then
		return
	fi

	case "$pm" in
	brew)
		if ! [ -d "/Applications/Docker.app" ]; then
			package_manager install docker --cask
		fi
		;;
	apk)
		install_packages docker
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

	getent="$(which getent)"
	if [ -n "$("$getent" group docker)" ]; then
		usermod="$(which usermod)"
		if [ -f "$usermod" ]; then
			execute "$usermod" -aG docker "$user"
		fi
	fi
}

install_tailscale() {
	if [ "$docker" = "1" ]; then
		return
	fi

	case "$os" in
	linux)
		sh="$(require sh)"
		script=$(download_file "https://tailscale.com/install.sh")
		execute "$sh" "$script"
		;;
	darwin)
		install_packages go
		execute_as_user go install tailscale.com/cmd/tailscale{,d}@latest
		append_to_path "$home/go/bin"
		;;
	esac
}

create_buildkite_user() {
	user="buildkite-agent"
	home="/var/lib/buildkite-agent"

	case "$distro" in
	amzn)
		execute dnf install -y \
			shadow-utils \
			util-linux
		;;
	esac

	getent="$(require getent)"
	if [ -z "$("$getent" passwd "$user")" ]; then
		useradd="$(require useradd)"
		execute "$useradd" "$user" \
			--system \
			--create-home \
			--home-dir "$home"
		execute chown -R "$user:$user" "$home"
	fi

	if [ -n "$("$getent" group docker)" ]; then
		usermod="$(require usermod)"
		execute "$usermod" -aG docker "$user"
	fi
}

create_buildkite_config() {
	etc="/etc/buildkite-agent"
	execute mkdir -p "$etc"

	file="$etc/buildkite-agent.cfg"
	if ! [ -f "$file" ]; then
		cat <<EOF >"$file"
# This is generated by scripts/bootstrap.sh
# https://buildkite.com/docs/agent/v3/configuration

name="%hostname-%random"
tags="v=$v,os=$os,arch=$arch,distro=$distro,release=$release,kernel=$kernel,glibc=$glibc"

build-path="$home/builds"
git-mirrors-path="$home/git"
job-log-path="$home/logs"
plugins-path="$etc/plugins"
hooks-path="$etc/hooks"

no-ssh-keyscan=true
cancel-grace-period=3600000 # 1 hour
enable-job-log-tmpfile=true
experiment="normalised-upload-paths,resolve-commit-after-checkout,agent-api"
EOF
	fi

	execute mkdir -p "$home/builds" "$home/logs" "$home/git"
	execute chown -R "$user:$user" "$home"
	execute chown -R "$user:$user" "$etc"
}

install_buildkite() {
	if ! [ "$ci" = "1" ]; then
		return
	fi

	bash="$(require bash)"
	script=$(download_file "https://raw.githubusercontent.com/buildkite/agent/main/install.sh")
	execute "$bash" "$script"

	out_dir="$HOME/.buildkite-agent"
	execute_sudo mv -f "$out_dir/bin/buildkite-agent" "/usr/bin/buildkite-agent"
	execute rm -rf "$out_dir"

	create_buildkite_config
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
	apk)
		echo # TODO:
		;;
	esac
}

main() {
	check_features
	check_operating_system
	check_user
	check_package_manager

	install_common_software
	install_build_essentials
	install_chrome_dependencies
}

main
