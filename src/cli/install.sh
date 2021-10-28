#!/bin/bash


# Reset
Color_Off=''       # Text Reset

# Regular Colors
Black=''        # Black
Red=''          # Red
Green=''        # Green
Yellow=''       # Yellow
Blue=''         # Blue
Purple=''       # Purple
Cyan=''         # Cyan
White=''        # White

# Bold
BBlack=''       # Black
BRed=''         # Red
BGreen=''       # Green
BYellow=''      # Yellow
BBlue=''        # Blue
BPurple=''      # Purple
BCyan=''        # Cyan
BWhite=''       # White

if test -t 1; then
# Reset
Color_Off='\033[0m'       # Text Reset

# Regular Colors
Black='\033[0;30m'        # Black
Red='\033[0;31m'          # Red
Green='\033[0;32m'        # Green
Yellow='\033[0;33m'       # Yellow
Blue='\033[0;34m'         # Blue
Purple='\033[0;35m'       # Purple
Cyan='\033[0;36m'         # Cyan
White='\033[0;37m'        # White

# Bold
BBlack='\033[1;30m'       # Black
BRed='\033[1;31m'         # Red
BGreen='\033[1;32m'       # Green
BYellow='\033[1;33m'      # Yellow
BBlue='\033[1;34m'        # Blue
BPurple='\033[1;35m'      # Purple
BCyan='\033[1;36m'        # Cyan
BWhite='\033[1;37m'       # White
fi


if ! command -v unzip >/dev/null; then
	echo -e "${Red}error${Color_Off}: unzip is required to install Bun (see: https://github.com/Jarred-Sumner/bun#unzip-is-required)." 1>&2
	exit 1
fi

if [ "$OS" = "Windows_NT" ]; then
	echo "error: Please install Bun using Windows Subsystem for Linux."
    exit 1
else
	case $(uname -sm) in
	"Darwin x86_64") target="darwin-x64" ;;
	"Darwin arm64") target="darwin-aarch64" ;;
	*) target="linux-x64" ;;
	esac
fi

github_repo="https://github.com/Jarred-Sumner/bun-releases-for-updater"

if [ $# -eq 0 ]; then
	bun_uri="$github_repo/releases/latest/download/bun-${target}.zip"
else
	bun_uri="$github_repo/releases/download/${1}/bun-${target}.zip"
fi

bun_install="${BUN_INSTALL:-$HOME/.bun}"
bin_dir="$bun_install/bin"
exe="$bin_dir/bun"

if [ ! -d "$bin_dir" ]; then
	mkdir -p "$bin_dir"
fi

curl --fail --location --progress-bar --output "$exe.zip" "$bun_uri"

if (( $? )); then
    echo -e "${Red}error${Color_Off}: Failed to download Bun from $bun_uri" 1>&2
    exit 1
fi
unzip -d "$bin_dir" -q -o "$exe.zip"
if (( $? )); then
    echo -e "${Red}error${Color_Off}: Failed to extract Bun" 1>&2
    exit 1
fi
mv "$bin_dir/bun-${target}/bun" "$exe"
if (( $? )); then
    echo -e "${Red}error${Color_Off}: Failed to extract Bun" 1>&2
    exit 1
fi
chmod +x "$exe"
if (( $? )); then
    echo -e "${Red}error${Color_Off}: Failed to set permissions on bun executable." 1>&2
    exit 1
fi
rmdir $bin_dir/bun-${target}
rm "$exe.zip"

echo -e "${Green}Bun was installed successfully to ${BGreen}$exe$Color_Off"

if command -v bun --version >/dev/null; then
    echo "Run 'bun --help' to get started"
    exit 0
fi

if test $(basename $SHELL) == "fish"; then
    echo ""
    echo "Manually add the directory to your \$HOME/.config/fish"
    echo ""
    echo -e "  $BWhite set -Ux BUN_INSTALL \"$bun_install\"$Color_Off"
    echo -e "  $BWhite set -px --path PATH \"$bin_dir\"$Color_Off"
elif test $(basename $SHELL) == "zsh"; then
    echo ""
    echo "Manually add the directory to your \$HOME/.zshrc (or similar)"
    echo ""
    echo -e "  $BWhite export BUN_INSTALL=\"$bun_install$Color_Off"
    echo -e "  $BWhite export PATH=\"\$BUN_INSTALL/bin:\$PATH\"$Color_Off"
else
    echo ""
    echo "Manually add the directory to your \$HOME/.bashrc (or similar)"
    echo ""
    echo -e "  $BWhiteexport BUN_INSTALL=\"$bun_install\"$Color_Off"
    echo -e "  $BWhiteexport PATH=\"\$BUN_INSTALL/bin:\$PATH\"$Color_Off"
fi
echo ""
echo -e "To get started, run"
echo -e "$BWhite"
echo -e "   bun --help$Color_Off"