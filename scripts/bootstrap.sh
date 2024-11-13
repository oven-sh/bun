#!/bin/sh

# A script that installs the dependencies needed to build and test Bun.
# This should work on macOS and Linux with a POSIX shell.

# If this script does not work on your machine, please open an issue:
# https://github.com/oven-sh/bun/issues

# If you need to make a change to this script, such as upgrading a dependency,
# increment the version number, `v`, to indicate that a new image should be built.
# Otherwise, the existing image will be retroactively updated.

# curl -fsSL "https://raw.githubusercontent.com/oven-sh/bun/refs/heads/ci-automated-build-image/scripts/bootstrap.sh" | CI=true sh

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
	if [ "$sudo" = "1" ] || [ -z "$can_sudo" ]; then
		execute "$@"
	else
		execute sudo "$@"
	fi
}

execute_as_user() {
	if [ "$sudo" = "1" ] || [ "$can_sudo" = "1" ]; then
		if [ -f "$(which sudo)" ]; then
			execute sudo -u "$user" /bin/sh -c "$*"
		elif [ -f "$(which doas)" ]; then
			execute doas -u "$user" /bin/sh -c "$*"
		elif [ -f "$(which su)" ]; then
			execute su -s /bin/sh "$user" -c "$*"
		else
			execute /bin/sh -c "$*"
		fi
	else
		execute /bin/sh -c "$*"
	fi
}

grant_to_user() {
	path="$1"
	execute_sudo chown -R "$user:$group" "$path"
}

which() {
	path="$(command -v "$1")"
	if [ -f "$path" ]; then
		echo "$path"
	elif [ "$can_sudo" = "1" ]; then
		execute_sudo which "$1"
	fi
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
	tmp="$(execute mktemp -d)"
	execute chmod 755 "$tmp"

	path="$tmp/$filename"
	fetch "$url" > "$path"
	execute chmod 644 "$path"

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

	append_to_profile "export PATH=\"$path:\$PATH\""
	export PATH="$path:$PATH"
}

link_to_bin() {
	path="$1"
	if ! [ -d "$path" ]; then
		error "Could not find directory: \"$path\""
	fi

	for file in "$path"/*; do
		if [ -f "$file" ]; then
			grant_to_user "$file"
			execute_sudo ln -sf "$file" "/usr/bin/$(basename "$file")"
		fi
	done
}

check_features() {
	print "Checking features..."

	case "$CI" in
	true | 1)
		ci=1
		print "CI: enabled"
		;;
	esac

	case "$@" in
	*--ci*)
		ci=1
		print "CI: enabled"
		;;
	esac
}

check_operating_system() {
	print "Checking operating system..."
	uname="$(require uname)"

	os="$("$uname" -s)"
	case "$os" in
	Linux*) os="linux" ;;
	Darwin*) os="darwin" ;;
	*) error "Unsupported operating system: $os" ;;
	esac
	print "Operating System: $os"

	arch="$("$uname" -m)"
	case "$arch" in
	x86_64 | x64 | amd64) arch="x64" ;;
	aarch64 | arm64) arch="aarch64" ;;
	*) error "Unsupported architecture: $arch" ;;
	esac
	print "Architecture: $arch"

	kernel="$("$uname" -r)"
	print "Kernel: $kernel"

	case "$os" in
	linux)
		ldd="$(which ldd)"
		awk="$(which awk)"
		if [ -f "$ldd" ] && [ -f "$awk" ]; then
			ldd_version="$($ldd --version 2>&1)"
			case "$ldd_version" in
			*musl*)
				abi="musl"
				abi_version="$(echo "$ldd_version" | "$awk" 'NR==2{print $NF}')"
				;;
			*GLIBC*)
				abi="gnu"
				abi_version="$(echo "$ldd_version" | "$awk" 'NR==1{print $NF}')"
				;;
			esac
		fi
		;;
	esac

	if [ -n "$abi" ]; then
		print "ABI: $abi $abi_version"
	fi

	case "$os" in
	linux)
		if [ -f "/etc/alpine-release" ]; then
			distro="alpine"
			alpine="$(cat /etc/alpine-release)"
			if [ "$alpine" ~ "_" ]; then
				release="$(echo "$alpine" | cut -d_ -f1)-edge"
			else
				release="$alpine"
			fi
		elif [ -f "/etc/os-release" ]; then
			. /etc/os-release
			if [ -n "$ID" ]; then
				distro="$ID"
			fi
			if [ -n "$VERSION_ID" ]; then
				release="$VERSION_ID"
			fi
		fi
		;;
	darwin)
		sw_vers="$(which sw_vers)"
		if [ -f "$sw_vers" ]; then
			distro="$("$sw_vers" -productName)"
			release="$("$sw_vers" -productVersion)"
		fi
		case "$arch" in
		x64)
			sysctl="$(which sysctl)"
			if [ -f "$sysctl" ] && [ "$("$sysctl" -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
				arch="aarch64"
				rosetta="1"
				print "Rosetta: enabled"
			fi
			;;
		esac
		;;
	esac

	if [ -n "$distro" ]; then
		print "Distribution: $distro $release"
	fi
}

check_inside_docker() {
	if ! [ "$os" = "linux" ]; then
		return
	fi
	print "Checking if inside Docker..."

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
		elif [ -f "$(which apk)" ]; then
			pm="apk"
		else
			error "No package manager found. (apt, dnf, yum, apk)"
		fi
		;;
	esac
	print "Package manager: $pm"

	print "Updating package manager..."
	case "$pm" in
	apt)
		package_manager update -y
		;;
	apk)
		package_manager update
		;;
	esac
}

check_user() {
	print "Checking user..."

	if [ -n "$SUDO_USER" ]; then
		user="$SUDO_USER"
	else
		id="$(require id)"
		user="$("$id" -un)"
		group="$("$id" -gn)"
	fi
	if [ -z "$user" ]; then
		error "Could not determine user"
	fi
	print "User: $user"
	print "Group: $group"

	home="$(execute_as_user echo '~')"
	if [ -z "$home" ] || [ "$home" = "~" ]; then
		error "Could not determine home directory for user: $user"
	fi
	print "Home: $home"

	id="$(which id)"
	if [ -f "$id" ] && [ "$($id -u)" = "0" ]; then
		sudo=1
		print "Sudo: enabled"
	elif [ -f "$(which sudo)" ] && [ "$(sudo echo 1 2>/dev/null)" = "1" ]; then
		can_sudo=1
		print "Sudo: can be used"
	fi
}

package_manager() {
	case "$pm" in
	apt)
		DEBIAN_FRONTEND=noninteractive execute_sudo apt-get "$@"
		;;
	dnf)
		execute_sudo dnf "$@"
		;;
	yum)
		execute_sudo yum "$@"
		;;
	apk)
		execute_sudo apk "$@"
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
		package_manager install \
			--yes \
			--no-install-recommends \
			"$@"
		;;
	dnf)
		package_manager install \
			--assumeyes \
			--nodocs \
			--noautoremove \
			--allowerasing \
			"$@"
		;;
	yum)
		package_manager install -y "$@"
		;;
	brew)
		package_manager install \
			--force \
			--formula \
			"$@"
		package_manager link \
			--force \
			--overwrite \
			"$@"
		;;
	apk)
		package_manager add \
			--no-cache \
			--no-interactive \
			--no-progress \
			"$@"
		;;
	*)
		error "Unsupported package manager: $pm"
		;;
	esac
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
			dnf-plugins-core
		;;
	esac

	case "$distro" in
	amzn)
		install_packages \
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

	if [ "$abi" = "gnu" ] && ! [ "$(compare_version "$abi_version" "2.27")" = "1" ]; then
		version="16"
	fi

	case "$pm" in
	dnf | yum)
		bash="$(require bash)"
		script=$(download_file "https://rpm.nodesource.com/setup_$version.x")
		execute_sudo "$bash" "$script"
		;;
	apt)
		bash="$(require bash)"
		script="$(download_file "https://deb.nodesource.com/setup_$version.x")"
		execute_sudo "$bash" "$script"
		;;
	esac

	install_packages nodejs

	case "$pm" in
	apk)
		install_packages npm
		;;
	esac
}

install_bun() {
	case "$os-$abi" in
	linux-musl)
		case "$arch" in
		x64)
			exe="$(download_file https://pub-61e0d0e2da4146a099e4545a59a9f0f7.r2.dev/bun-musl-x64)"
			;;
		aarch64)
			exe="$(download_file https://pub-61e0d0e2da4146a099e4545a59a9f0f7.r2.dev/bun-musl-arm64)"
			;;
		esac
		execute chmod +x "$exe"
		execute mkdir -p "$home/.bun/bin"
		execute mv "$exe" "$home/.bun/bin/bun"
		execute ln -fs "$home/.bun/bin/bun" "$home/.bun/bin/bunx"
		link_to_bin "$home/.bun/bin"
		return
		;;
	esac

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
	case "$os-$pm" in
	darwin-* | linux-apk)
		install_packages cmake
		;;
	linux-*)
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
		execute_sudo "$sh" "$script" \
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
			build-base \
			ninja \
			go \
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
	case "$os-$abi" in
	darwin-* | windows-* | linux-musl)
		print "18.1.8"
		;;
	linux-*)
		print "16.0.6"
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
		execute_sudo "$bash" "$script" "$(llvm_version)" all
		;;
	brew)
		install_packages "llvm@$(llvm_version)"
		;;
	apk)
		install_packages \
			"llvm$(llvm_version)" \
			"clang$(llvm_version)" \
			"scudo-malloc" \
			--repository "http://dl-cdn.alpinelinux.org/alpine/edge/main"
		install_packages \
			"lld$(llvm_version)" \
			--repository "http://dl-cdn.alpinelinux.org/alpine/edge/community"
		;;
	esac
}

install_ccache() {
	case "$pm" in
	apt | apk | brew)
		install_packages ccache
		;;
	esac
}

install_rust() {
	case "$pm" in
	apk)
		install_packages \
			rust \
			cargo
		;;
	*)
		sh="$(require sh)"
		script=$(download_file "https://sh.rustup.rs")
		execute_as_user "$sh" "$script" -y
		;;
	esac

	# FIXME: This causes cargo to fail to build:
	# > error: rustup could not choose a version of cargo to run,
	# > because one wasn't specified explicitly, and no default is configured.
	# link_to_bin "$home/.cargo/bin"
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
		amzn-* | alpine-*)
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
		execute_sudo "$systemctl" enable docker
	fi

	getent="$(which getent)"
	if [ -n "$("$getent" group docker)" ]; then
		usermod="$(which usermod)"
		if [ -f "$usermod" ]; then
			execute_sudo "$usermod" -aG docker "$user"
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
	if ! [ "$ci" = "1" ] || ! [ "$os" = "linux" ]; then
		return
	fi

	print "Creating Buildkite user..."
	user="buildkite-agent"
	group="$user"
	home="/var/lib/buildkite-agent"

	case "$distro" in
	amzn)
		install_packages \
			shadow-utils \
			util-linux
		;;
	esac

	getent="$(require getent)"
	if [ -z "$("$getent" passwd "$user")" ]; then
		useradd="$(require useradd)"
		execute_sudo "$useradd" "$user" \
			--system \
			--no-create-home \
			--home-dir "$home"
	fi

	if [ -n "$("$getent" group docker)" ]; then
		usermod="$(require usermod)"
		execute_sudo "$usermod" -aG docker "$user"
	fi

	paths="$home /var/cache/buildkite-agent /var/log/buildkite-agent /var/run/buildkite-agent/buildkite-agent.sock"
	for path in $paths; do
		execute_sudo mkdir -p "$path"
		execute_sudo chown -R "$user:$group" "$path"
	done
}

install_buildkite() {
	if ! [ "$ci" = "1" ]; then
		return
	fi

	bash="$(require bash)"
	script="$(download_file "https://raw.githubusercontent.com/buildkite/agent/main/install.sh")"
	tmp_dir="$(execute dirname "$script")"
	HOME="$tmp_dir" execute "$bash" "$script"

	out_dir="$tmp_dir/.buildkite-agent"
	execute_sudo mv -f "$out_dir/bin/buildkite-agent" "/usr/bin/buildkite-agent"
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
	check_features "$@"
	check_operating_system
	check_inside_docker
	check_user
	check_package_manager
	create_buildkite_user
	install_common_software
	install_build_essentials
	install_chrome_dependencies
}

main "$@"
