#!/bin/sh

# wget -O - https://raw.githubusercontent.com/alxivnov/bun/alpine/src/cli/install-alpine.sh | sh

# if [ $(cat /etc/os-release | grep -c "alpine") -gt 0 ]; then
	apk add --no-cache gcompat

	GITHUB="https://github.com"

	if [ $(uname -m) == "aarch64" ]; then
		target="linux-aarch64"

		# AArch64 https://github.com/SatoshiPortal/alpine-pkg-glibc
		GLIBC="$GITHUB/SatoshiPortal/alpine-pkg-glibc/releases/download/2.33-r0/glibc-2.33-r0-aarch64.apk"
		GLIBC_BIN="$GITHUB/SatoshiPortal/alpine-pkg-glibc/releases/download/2.33-r0/glibc-bin-2.33-r0-aarch64.apk"
		# GLIBC="https://raw.githubusercontent.com/squishyu/alpine-pkg-glibc-aarch64-bin/master/glibc-2.26-r1.apk"
		# GLIBC_BIN="https://raw.githubusercontent.com/squishyu/alpine-pkg-glibc-aarch64-bin/master/glibc-bin-2.26-r1.apk"
	else
		target="linux-x64"

		# x86-64 https://github.com/sgerrand/alpine-pkg-glibc
		GLIBC="$GITHUB/sgerrand/alpine-pkg-glibc/releases/download/2.35-r1/glibc-2.35-r1.apk"
		GLIBC_BIN="$GITHUB/sgerrand/alpine-pkg-glibc/releases/download/2.35-r1/glibc-bin-2.35-r1.apk"
	fi

	if [ $(apk info | grep -c "glibc") -eq 0 ]; then
		wget -O "glibc.apk" "$GLIBC"
		# wget -q -O "glibc-bin.apk" "$GLIBC_BIN"
		apk add --allow-untrusted --force-overwrite --no-cache "glibc.apk" #"glibc-bin.apk"
		rm "glibc.apk" #"glibc-bin.apk"
	fi



	exe_name=bun
	BUNX=bunx

	if [ $# -ge 2 ] && [ $2 == "debug-info" ]; then
		target=$target-profile
		exe_name=$exe_name-profile
		# BUNX=$BUNX-profile
		info "You requested a debug build of bun. More information will be shown if a crash occurs."
	fi

	if [ $# -ge 1 ]; then
		bun_uri=$GITHUB/oven-sh/bun/releases/download/bun-v$1/bun-$target.zip
		# bun_uri=$GITHUB/oven-sh/bun/releases/download/$1/bun-$target.zip
	else
		bun_uri=$GITHUB/oven-sh/bun/releases/latest/download/bun-$target.zip
	fi

	if [ $(ls /usr/local/bin | grep -c "$exe_name") -eq 0 ]; then
		wget -O "bun.zip" "$bun_uri"
		unzip -o "bun.zip"
		mv "bun-$target/$exe_name" "/usr/local/bin/$exe_name"
		rm -r "bun.zip" "bun-$target"

		ln -s /usr/local/bin/$exe_name /usr/local/bin/$BUNX
	fi



	which $exe_name
	which $BUNX
	$exe_name --version
# fi
