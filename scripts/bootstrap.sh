#!/bin/sh
# Version: 9

# A script that installs the dependencies needed to build and test Bun.
# This should work on macOS and Linux with a POSIX shell.

# If this script does not work on your machine, please open an issue:
# https://github.com/oven-sh/bun/issues

# If you need to make a change to this script, such as upgrading a dependency,
# increment the version comment to indicate that a new image should be built.
# Otherwise, the existing image will be retroactively updated.

pid="$$"

print() {
	echo "$@"
}

error() {
	print "error: $@" >&2
	if ! [ "$$" = "$pid" ]; then
		kill -s TERM "$pid"
	fi
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
		execute sudo -n "$@"
	fi
}

execute_as_user() {
	sh="$(require sh)"

	if [ "$sudo" = "1" ] || [ "$can_sudo" = "1" ]; then
		if [ -f "$(which sudo)" ]; then
			execute sudo -n -u "$user" "$sh" -lc "$*"
		elif [ -f "$(which doas)" ]; then
			execute doas -u "$user" "$sh" -lc "$*"
		elif [ -f "$(which su)" ]; then
			execute su -s "$sh" "$user" -lc "$*"
		else
			execute "$sh" -lc "$*"
		fi
	else
		execute "$sh" -lc "$*"
	fi
}

grant_to_user() {
	path="$1"
	if ! [ -f "$path" ] && ! [ -d "$path" ]; then
		error "Could not find file or directory: \"$path\""
	fi

	chown="$(require chown)"
	execute_sudo "$chown" -R "$user:$group" "$path"
	execute_sudo chmod -R 777 "$path"
}

which() {
	command -v "$1"
}

require() {
	path="$(which "$1")"
	if ! [ -f "$path" ]; then
		error "Command \"$1\" is required, but is not installed."
	fi
	print "$path"
}

fetch() {
	curl="$(which curl)"
	if [ -f "$curl" ]; then
		execute "$curl" -fsSL "$1"
	else
		wget="$(which wget)"
		if [ -f "$wget" ]; then
			execute "$wget" -qO- "$1"
		else
			error "Command \"curl\" or \"wget\" is required, but is not installed."
		fi
	fi
}

compare_version() {
	if [ "$1" = "$2" ]; then
		print "0"
	elif [ "$1" = "$(echo -e "$1\n$2" | sort -V | head -n1)" ]; then
		print "-1"
	else
		print "1"
	fi
}

create_directory() {
	path="$1"
	path_dir="$path"
	while ! [ -d "$path_dir" ]; do
		path_dir="$(dirname "$path_dir")"
	done

	path_needs_sudo="0"
	if ! [ -r "$path_dir" ] || ! [ -w "$path_dir" ]; then
		path_needs_sudo="1"
	fi

	mkdir="$(require mkdir)"
	if [ "$path_needs_sudo" = "1" ]; then
		execute_sudo "$mkdir" -p "$path"
	else
		execute "$mkdir" -p "$path"
	fi

	grant_to_user "$path"
}

create_tmp_directory() {
	mktemp="$(require mktemp)"
	path="$(execute "$mktemp" -d)"
	grant_to_user "$path"	
	print "$path"
}

create_file() {
	path="$1"
	path_dir="$(dirname "$path")"
	if ! [ -d "$path_dir" ]; then
		create_directory "$path_dir"
	fi

	path_needs_sudo="0"
	if ! [ -r "$path" ] || ! [ -w "$path" ]; then
		path_needs_sudo="1"
	fi

	if [ "$path_needs_sudo" = "1" ]; then
		execute_sudo touch "$path"
	else
		execute touch "$path"
	fi

	content="$2"
	if [ -n "$content" ]; then
		append_file "$path" "$content"
	fi

	grant_to_user "$path"
}

append_file() {
	path="$1"
	if ! [ -f "$path" ]; then
		create_file "$path"
	fi

	path_needs_sudo="0"
	if ! [ -r "$path" ] || ! [ -w "$path" ]; then
		path_needs_sudo="1"
	fi

	content="$2"
	print "$content" | while read -r line; do
		if ! grep -q "$line" "$path"; then
		  sh="$(require sh)"
			if [ "$path_needs_sudo" = "1" ]; then
				execute_sudo "$sh" -c "echo '$line' >> '$path'"
			else
				execute "$sh" -c "echo '$line' >> '$path'"
			fi
		fi
	done
}

download_file() {
	file_url="$1"
	file_tmp_dir="$(create_tmp_directory)"
	file_tmp_path="$file_tmp_dir/$(basename "$file_url")"

	fetch "$file_url" >"$file_tmp_path"
	grant_to_user "$file_tmp_path"
	
	print "$file_tmp_path"
}

append_to_profile() {
	content="$1"
	profiles=".profile .zprofile .bash_profile .bashrc .zshrc"
	for profile in $profiles; do
		for profile_path in "$current_home/$profile" "$home/$profile"; do
			if [ "$ci" = "1" ] || [ -f "$profile_path" ]; then
				append_file "$profile_path" "$content"
			fi
		done
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

move_to_bin() {
	exe_path="$1"
	if ! [ -f "$exe_path" ]; then
		error "Could not find executable: \"$exe_path\""
	fi

	usr_paths="/usr/bin /usr/local/bin"
	for usr_path in $usr_paths; do
		if [ -d "$usr_path" ] && [ -w "$usr_path" ]; then
			break
		fi
	done

	grant_to_user "$exe_path"
	execute_sudo mv -f "$exe_path" "$usr_path/$(basename "$exe_path")"
}

check_features() {
	print "Checking features..."

	for arg in "$@"; do
		case "$arg" in
		*--ci*)
			ci=1
			print "CI: enabled"
			;;
		*--osxcross*)
			osxcross=1
			print "Cross-compiling to macOS: enabled"
			;;
		*--gcc-13*)
			gcc_version="13"
			print "GCC 13: enabled"
			;;
		esac
	done
}

check_operating_system() {
	print "Checking operating system..."
	uname="$(require uname)"

	os="$("$uname" -s)"
	case "$os" in
	Linux*)
		os="linux"
		;;
	Darwin*)
		os="darwin"
		;;
	*)
		error "Unsupported operating system: $os"
		;;
	esac
	print "Operating System: $os"

	arch="$("$uname" -m)"
	case "$arch" in
	x86_64 | x64 | amd64)
		arch="x64"
		;;
	aarch64 | arm64)
		arch="aarch64"
		;;
	*)
		error "Unsupported architecture: $arch"
		;;
	esac
	print "Architecture: $arch"

	kernel="$("$uname" -r)"
	print "Kernel: $kernel"

	case "$os" in
	linux)
		if [ -f "/etc/alpine-release" ]; then
			distro="alpine"
			abi="musl"
			alpine="$(cat /etc/alpine-release)"
			if [ "$alpine" ~ "_" ]; then
				release="$(print "$alpine" | cut -d_ -f1)-edge"
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

	case "$os" in
	linux)
		ldd="$(which ldd)"
		if [ -f "$ldd" ]; then
			ldd_version="$($ldd --version 2>&1)"
			abi_version="$(print "$ldd_version" | grep -o -E '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n 1)"
			case "$ldd_version" in
			*musl*)
				abi="musl"
				;;
			*GNU* | *GLIBC*)
				abi="gnu"
				;;
			esac
		fi

		if [ -n "$abi" ]; then
			print "ABI: $abi $abi_version"
		fi
		;;
	esac
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
		if [ -f "$(which apt)" ]; then
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
		export DEBIAN_FRONTEND=noninteractive
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
	elif [ -f "$(which sudo)" ] && [ "$(sudo -n echo 1 2>/dev/null)" = "1" ]; then
		can_sudo=1
		print "Sudo: can be used"
	fi

	current_user="$user"
	current_group="$group"
	current_home="$home"
}

check_ulimit() {
	if ! [ "$ci" = "1" ]; then
		return
	fi

	print "Checking ulimits..."
	systemd_conf="/etc/systemd/system.conf"
	if [ -f "$systemd_conf" ]; then
		limits_conf="/etc/security/limits.d/99-unlimited.conf"
		create_file "$limits_conf"
	fi

	limits="core data fsize memlock nofile rss stack cpu nproc as locks sigpending msgqueue"
	for limit in $limits; do
		limit_upper="$(print "$limit" | tr '[:lower:]' '[:upper:]')"

		limit_value="unlimited"
		case "$limit" in
		nofile | nproc)
			limit_value="1048576"
			;;
		esac

		if [ -f "$limits_conf" ]; then
			limit_users="root *"
			for limit_user in $limit_users; do
				append_file "$limits_conf" "$limit_user soft $limit $limit_value"
				append_file "$limits_conf" "$limit_user hard $limit $limit_value"
			done
		fi

		if [ -f "$systemd_conf" ]; then
			append_file "$systemd_conf" "DefaultLimit$limit_upper=$limit_value"
		fi
	done

	rc_conf="/etc/rc.conf"
	if [ -f "$rc_conf" ]; then
		rc_ulimit=""
		limit_flags="c d e f i l m n q r s t u v x"
		for limit_flag in $limit_flags; do
			limit_value="unlimited"
			case "$limit_flag" in
			n | u)
				limit_value="1048576"
				;;
			esac
			rc_ulimit="$rc_ulimit -$limit_flag $limit_value"
		done
		append_file "$rc_conf" "rc_ulimit=\"$rc_ulimit\""
	fi

	pam_confs="/etc/pam.d/common-session /etc/pam.d/common-session-noninteractive"
	for pam_conf in $pam_confs; do
		if [ -f "$pam_conf" ]; then
			append_file "$pam_conf" "session optional pam_limits.so"
		fi
	done

	systemctl="$(which systemctl)"
	if [ -f "$systemctl" ]; then
		execute_sudo "$systemctl" daemon-reload
	fi

	# Configure dpkg and apt for faster operation in CI environments
	if [ "$ci" = "1" ] && [ "$pm" = "apt" ]; then
		dpkg_conf="/etc/dpkg/dpkg.cfg.d/01-ci-options"
		execute_sudo create_directory "$(dirname "$dpkg_conf")"
		append_file "$dpkg_conf" "force-unsafe-io"
		append_file "$dpkg_conf" "no-debsig"

		apt_conf="/etc/apt/apt.conf.d/99-ci-options" 
		execute_sudo create_directory "$(dirname "$apt_conf")"
		append_file "$apt_conf" 'Acquire::Languages "none";'
		append_file "$apt_conf" 'Acquire::GzipIndexes "true";'
		append_file "$apt_conf" 'Acquire::CompressionTypes::Order:: "gz";'
		append_file "$apt_conf" 'APT::Get::Install-Recommends "false";'
		append_file "$apt_conf" 'APT::Get::Install-Suggests "false";'
		append_file "$apt_conf" 'Dpkg::Options { "--force-confdef"; "--force-confold"; }'
	fi

}

package_manager() {
	case "$pm" in
	apt)
		execute_sudo apt "$@"
		;;
	dnf)
		case "$distro" in
		rhel)
			execute_sudo dnf \
				--disableplugin=subscription-manager \
				"$@"
			;;
		*)
			execute_sudo dnf "$@"
			;;
		esac
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
	execute_as_user "$bash" -lc "NONINTERACTIVE=1 $script"

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
	rhel)
		rhel_version="$(execute rpm -E %rhel)"
		install_packages \
			"https://dl.fedoraproject.org/pub/epel/epel-release-latest-$rhel_version.noarch.rpm"
		;;
	centos)
		install_packages \
			epel-release
		;;
	esac

	crb="$(which crb)"
	if [ -f "$crb" ]; then
		execute "$crb" enable
	fi

	install_packages \
		bash \
		ca-certificates \
		curl \
		htop \
		gnupg \
		git \
		unzip \
		wget

	install_rosetta
	install_nodejs
	install_bun
	install_tailscale
	install_buildkite
}

nodejs_version_exact() {
	# https://unofficial-builds.nodejs.org/download/release/
	if ! [ "$abi" = "musl" ] && [ -n "$abi_version" ] && ! [ "$(compare_version "$abi_version" "2.27")" = "1" ]; then
		print "16.9.1"
	else
		print "22.9.0"
	fi
}

nodejs_version() {
	print "$(nodejs_version_exact)" | cut -d. -f1
}

install_nodejs() {
	case "$pm" in
	dnf | yum)
		bash="$(require bash)"
		script=$(download_file "https://rpm.nodesource.com/setup_$(nodejs_version).x")
		execute_sudo "$bash" "$script"
		;;
	apt)
		bash="$(require bash)"
		script="$(download_file "https://deb.nodesource.com/setup_$(nodejs_version).x")"
		execute_sudo "$bash" "$script"
		;;
	esac

	case "$pm" in
	apk)
		install_packages nodejs npm
		;;
	*)
		install_packages nodejs
		;;
	esac

	# Some distros do not install the node headers by default.
	# These are needed for certain FFI tests, such as: `cc.test.ts`
	case "$distro" in
	alpine | amzn)
		install_nodejs_headers
		;;
	esac
}

install_nodejs_headers() {
	nodejs_headers_tar="$(download_file "https://nodejs.org/download/release/v$(nodejs_version_exact)/node-v$(nodejs_version_exact)-headers.tar.gz")"
	nodejs_headers_dir="$(dirname "$nodejs_headers_tar")"
	execute tar -xzf "$nodejs_headers_tar" -C "$nodejs_headers_dir"

	nodejs_headers_include="$nodejs_headers_dir/node-v$(nodejs_version_exact)/include"
	execute_sudo cp -R "$nodejs_headers_include/" "/usr"
}

bun_version_exact() {
	print "1.2.0"
}

install_bun() {
	install_packages unzip

	case "$pm" in
	apk)
		install_packages \
			libgcc \
			libstdc++
		;;
	esac

	case "$abi" in
	musl)
		bun_triplet="bun-$os-$arch-$abi"
		;;
	*)
		bun_triplet="bun-$os-$arch"
		;;
	esac

	unzip="$(require unzip)"
	bun_download_url="https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/bun-v$(bun_version_exact)/$bun_triplet.zip"
	bun_zip="$(download_file "$bun_download_url")"
	bun_tmpdir="$(dirname "$bun_zip")"
	execute "$unzip" -o "$bun_zip" -d "$bun_tmpdir"

	move_to_bin "$bun_tmpdir/$bun_triplet/bun"
	bun_path="$(require bun)"
	execute_sudo ln -sf "$bun_path" "$(dirname "$bun_path")/bunx"
}

install_cmake() {
	case "$os-$pm" in
	darwin-* | linux-apk)
		install_packages cmake
		;;
	linux-*)
		sh="$(require sh)"
		cmake_version="3.30.5"
		case "$arch" in
		x64)
			cmake_url="https://github.com/Kitware/CMake/releases/download/v$cmake_version/cmake-$cmake_version-linux-x86_64.sh"
			;;
		aarch64)
			cmake_url="https://github.com/Kitware/CMake/releases/download/v$cmake_version/cmake-$cmake_version-linux-aarch64.sh"
			;;
		esac
		cmake_script=$(download_file "$cmake_url")
		execute_sudo "$sh" "$cmake_script" \
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
			gcc-c++ \
			xz \
			pkg-config \
			golang
		case "$distro" in
		rhel) ;;
		*)
			install_packages ninja-build
			;;
		esac
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
			linux-headers \
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
	install_osxcross
	install_gcc
	install_ccache
	install_rust
	install_docker
}

llvm_version_exact() {
	print "18.1.8"
}

llvm_version() {
	print "$(llvm_version_exact)" | cut -d. -f1
}

install_llvm() {
	case "$pm" in
	apt)
		bash="$(require bash)"
		llvm_script="$(download_file "https://apt.llvm.org/llvm.sh")"
		execute_sudo "$bash" "$llvm_script" "$(llvm_version)" all
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

install_gcc() {
	if ! [ "$os" = "linux" ] || ! [ "$distro" = "ubuntu" ] || [ -z "$gcc_version" ]; then
		return
	fi

	# Taken from WebKit's Dockerfile.
	# https://github.com/oven-sh/WebKit/blob/816a3c02e0f8b53f8eec06b5ed911192589b51e2/Dockerfile

	execute_sudo add-apt-repository ppa:ubuntu-toolchain-r/test -y
	execute_sudo apt update -y
	execute_sudo apt install -y \
		"gcc-$gcc_version" \
		"g++-$gcc_version" \
		"libgcc-$gcc_version-dev" \
		"libstdc++-$gcc_version-dev" \
		libasan6 \
		libubsan1 \
		libatomic1 \
		libtsan0 \
		liblsan0 \
		libgfortran5 \
		libc6-dev

	execute_sudo update-alternatives \
		--install /usr/bin/gcc gcc "/usr/bin/gcc-$gcc_version" 130 \
		--slave /usr/bin/g++ g++ "/usr/bin/g++-$gcc_version" \
		--slave /usr/bin/gcc-ar gcc-ar "/usr/bin/gcc-ar-$gcc_version" \
		--slave /usr/bin/gcc-nm gcc-nm "/usr/bin/gcc-nm-$gcc_version" \
		--slave /usr/bin/gcc-ranlib gcc-ranlib "/usr/bin/gcc-ranlib-$gcc_version"

	case "$arch" in
	x64)
		arch_path="x86_64-linux-gnu"
		;;
	aarch64)
		arch_path="aarch64-linux-gnu"
		;;
	esac

	llvm_v="18"

	append_to_profile "export CC=clang-${llvm_v}"
	append_to_profile "export CXX=clang++-${llvm_v}"
	append_to_profile "export AR=llvm-ar-${llvm_v}"
	append_to_profile "export RANLIB=llvm-ranlib-${llvm_v}"
	append_to_profile "export LD=lld-${llvm_v}"
	append_to_profile "export LD_LIBRARY_PATH=/usr/lib/gcc/${arch_path}/${gcc_version}:/usr/lib/${arch_path}"
	append_to_profile "export LIBRARY_PATH=/usr/lib/gcc/${arch_path}/${gcc_version}:/usr/lib/${arch_path}"
	append_to_profile "export CPLUS_INCLUDE_PATH=/usr/include/c++/${gcc_version}:/usr/include/${arch_path}/c++/${gcc_version}"
	append_to_profile "export C_INCLUDE_PATH=/usr/lib/gcc/${arch_path}/${gcc_version}/include"

	gcc_path="/usr/lib/gcc/$arch_path/$gcc_version"
	create_directory "$gcc_path"
	execute_sudo ln -sf /usr/lib/$arch_path/libstdc++.so.6 "$gcc_path/libstdc++.so.6"

	ld_conf_path="/etc/ld.so.conf.d/gcc-$gcc_version.conf"
	append_file "$ld_conf_path" "$gcc_path"
	append_file "$ld_conf_path" "/usr/lib/$arch_path"
	execute_sudo ldconfig

	execute_sudo ln -sf $(which clang-$llvm_v) /usr/bin/clang
	execute_sudo ln -sf $(which clang++-$llvm_v) /usr/bin/clang++
	execute_sudo ln -sf $(which lld-$llvm_v) /usr/bin/lld
	execute_sudo ln -sf $(which lldb-$llvm_v) /usr/bin/lldb
	execute_sudo ln -sf $(which clangd-$llvm_v) /usr/bin/clangd
	execute_sudo ln -sf $(which llvm-ar-$llvm_v) /usr/bin/llvm-ar
	execute_sudo ln -sf $(which ld.lld-$llvm_v) /usr/bin/ld
	execute_sudo ln -sf $(which clang) /usr/bin/cc
	execute_sudo ln -sf $(which clang++) /usr/bin/c++
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
		rust_home="/opt/rust"
		create_directory "$rust_home"
		append_to_profile "export RUSTUP_HOME=$rust_home"
		append_to_profile "export CARGO_HOME=$rust_home"

		sh="$(require sh)"
		rustup_script=$(download_file "https://sh.rustup.rs")
		execute "$sh" -lc "$rustup_script -y --no-modify-path"
		append_to_path "$rust_home/bin"
		;;
	esac

	case "$osxcross" in
	1)
		rustup="$(require rustup)"
		execute_as_user "$rustup" target add aarch64-apple-darwin
		execute_as_user "$rustup" target add x86_64-apple-darwin
		;;
	esac
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
			execute_sudo amazon-linux-extras install docker
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

macos_sdk_version() {
	# https://github.com/alexey-lysiuk/macos-sdk/releases
	print "13.3"
}

install_osxcross() {
	if ! [ "$os" = "linux" ] || ! [ "$osxcross" = "1" ]; then
		return
	fi

	install_packages \
		libssl-dev \
		lzma-dev \
		libxml2-dev \
		zlib1g-dev \
		bzip2 \
		cpio

	osxcross_path="/opt/osxcross"
	create_directory "$osxcross_path"

	osxcross_commit="29fe6dd35522073c9df5800f8cd1feb4b9a993a8"
	osxcross_tar="$(download_file "https://github.com/tpoechtrager/osxcross/archive/$osxcross_commit.tar.gz")"
	execute tar -xzf "$osxcross_tar" -C "$osxcross_path"

	osxcross_build_path="$osxcross_path/build"
	execute mv "$osxcross_path/osxcross-$osxcross_commit" "$osxcross_build_path"

	osxcross_sdk_tar="$(download_file "https://github.com/alexey-lysiuk/macos-sdk/releases/download/$(macos_sdk_version)/MacOSX$(macos_sdk_version).tar.xz")"
	execute mv "$osxcross_sdk_tar" "$osxcross_build_path/tarballs/MacOSX$(macos_sdk_version).sdk.tar.xz"

	bash="$(require bash)"
	execute_sudo ln -sf "$(which clang-$(llvm_version))" /usr/bin/clang
	execute_sudo ln -sf "$(which clang++-$(llvm_version))" /usr/bin/clang++
	execute_sudo "$bash" -lc "UNATTENDED=1 TARGET_DIR='$osxcross_path' $osxcross_build_path/build.sh"

	execute_sudo rm -rf "$osxcross_build_path"
	grant_to_user "$osxcross_path"
}

install_tailscale() {
	if [ "$docker" = "1" ]; then
		return
	fi

	case "$os" in
	linux)
		sh="$(require sh)"
		tailscale_script=$(download_file "https://tailscale.com/install.sh")
		execute "$sh" "$tailscale_script"
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

	if [ -z "$(getent passwd "$user")" ]; then
		case "$distro" in
		alpine)
			execute_sudo addgroup \
				--system "$group"
			execute_sudo adduser "$user" \
				--system \
				--ingroup "$group" \
				--shell "$(require sh)" \
				--home "$home" \
				--disabled-password
			;;
		*)
			execute_sudo useradd "$user" \
				--system \
				--shell "$(require sh)" \
				--no-create-home \
				--home-dir "$home"
			;;
		esac
	fi

	if [ -n "$(getent group docker)" ]; then
		execute_sudo usermod -aG docker "$user"
	fi

	buildkite_paths="$home /var/cache/buildkite-agent /var/log/buildkite-agent /var/run/buildkite-agent /var/run/buildkite-agent/buildkite-agent.sock"
	for path in $buildkite_paths; do
		create_directory "$path"
	done

	buildkite_files="/var/run/buildkite-agent/buildkite-agent.pid"
	for file in $buildkite_files; do
		create_file "$file"
	done
}

install_buildkite() {
	if ! [ "$ci" = "1" ]; then
		return
	fi

	buildkite_version="3.87.0"
	case "$arch" in
	aarch64)
		buildkite_arch="arm64"
		;;
	x64)
		buildkite_arch="amd64"
		;;
	esac

	buildkite_filename="buildkite-agent-$os-$buildkite_arch-$buildkite_version.tar.gz"
	buildkite_url="https://github.com/buildkite/agent/releases/download/v$buildkite_version/$buildkite_filename"
	buildkite_tar="$(download_file "$buildkite_url")"
	buildkite_tmpdir="$(dirname "$buildkite_tar")"

	execute tar -xzf "$buildkite_tar" -C "$buildkite_tmpdir"
	move_to_bin "$buildkite_tmpdir/buildkite-agent"
}

install_chromium() {
	# https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#chrome-doesnt-launch-on-linux
	# https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-in-the-cloud
	case "$pm" in
	apk)
		install_packages \
			chromium \
      nss \
      freetype \
      harfbuzz \
      ttf-freefont
		;;
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

	case "$distro" in
	amzn)
		install_packages \
			mesa-libgbm
		;;
	esac
}

clean_system() {
	if ! [ "$ci" = "1" ]; then
		return
	fi

	print "Cleaning system..."

	tmp_paths="/tmp /var/tmp"
	for path in $tmp_paths; do
		execute_sudo rm -rf "$path"/*
	done
}

main() {
	check_features "$@"
	check_operating_system
	check_inside_docker
	check_user
	check_ulimit
	check_package_manager
	create_buildkite_user
	install_common_software
	install_build_essentials
	install_chromium
	clean_system
}

main "$@"
