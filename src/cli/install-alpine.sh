#!/bin/sh

# sh -c '$(wget -O - https://raw.githubusercontent.com/alxivnov/bun/alpine/src/cli/install-alpine.sh)'
# wget -O ./install.sh https://raw.githubusercontent.com/alxivnov/bun/alpine/src/cli/install-alpine.sh; chmod +x ./install.sh; ./install.sh; rm ./install.sh

# if [ $(cat /etc/os-release | grep -c 'alpine') -gt 0 ]; then
	GITHUB="https://github.com"

	if [ $(uname -m) == 'aarch64' ]; then
		TARGET="linux-aarch64"

		# AArch64 https://github.com/SatoshiPortal/alpine-pkg-glibc
		GLIBC="$GITHUB/SatoshiPortal/alpine-pkg-glibc/releases/download/2.33-r0/glibc-2.33-r0-aarch64.apk"
		GLIBC_BIN="$GITHUB/SatoshiPortal/alpine-pkg-glibc/releases/download/2.33-r0/glibc-bin-2.33-r0-aarch64.apk"
		# GLIBC="https://raw.githubusercontent.com/squishyu/alpine-pkg-glibc-aarch64-bin/master/glibc-2.26-r1.apk"
		# GLIBC_BIN="https://raw.githubusercontent.com/squishyu/alpine-pkg-glibc-aarch64-bin/master/glibc-bin-2.26-r1.apk"
	else
		TARGET="linux-x64"

		# x86-64 https://github.com/sgerrand/alpine-pkg-glibc
		GLIBC="$GITHUB/sgerrand/alpine-pkg-glibc/releases/download/2.35-r1/glibc-2.35-r1.apk"
		GLIBC_BIN="$GITHUB/sgerrand/alpine-pkg-glibc/releases/download/2.35-r1/glibc-bin-2.35-r1.apk"
	fi



	if [ $(apk info | grep -c 'glibc') -eq 0 ]; then
		wget -O "glibc.apk" "$GLIBC"
		# wget -q -O "glibc-bin.apk" "$GLIBC_BIN"
		apk add --allow-untrusted --force-overwrite --no-cache "glibc.apk" #"glibc-bin.apk"
		rm "glibc.apk" #"glibc-bin.apk"
	fi

	if [ $(ls /usr/local/bin | grep -c 'bun') -eq 0 ]; then
		wget -O "bun.zip" "$GITHUB/oven-sh/bun/releases/latest/download/bun-$TARGET.zip"
		unzip -o "bun.zip"
		mv "bun-$TARGET/bun" "/usr/local/bin/bun"
		rm -r "bun.zip" "bun-$TARGET"

		ln -s /usr/local/bin/bun /usr/local/bin/bunx
	fi



	which bun
	which bunx
	bun --version
# fi
