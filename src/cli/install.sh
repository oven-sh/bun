#!/usr/bin/env bash

# Reset
Color_Off=''

# Regular Colors
Red=''
Green=''

# Bold
Bold=''
BGreen=''

Dim='' # White

if test -t 1; then
    # Reset
    Color_Off='\033[0m' # Text Reset

    # Regular Colors
    Red='\033[0;31m'   # Red
    Green='\033[0;32m' # Green

    Dim='\033[0;2m' # White

    # Bold
    BGreen='\033[1;32m' # Green
    Bold='\033[1m' # White
fi

if ! command -v unzip >/dev/null; then
    echo -e "\n${Red}error${Color_Off}: unzip is required to install bun (see: https://github.com/oven-sh/bun#unzip-is-required)." 1>&2
    exit 1
fi

if [ "$OS" = "Windows_NT" ]; then
    echo "error: Please install bun using Windows Subsystem for Linux."
    exit 1
else
    case $(uname -sm) in
    "Darwin x86_64") target="darwin-x64" ;;
    "Darwin arm64") target="darwin-aarch64" ;;
    "Linux aarch64") target="linux-aarch64" ;;
    "Linux arm64") target="linux-aarch64" ;;
    "Linux x86_64") target="linux-x64" ;;
    *) target="linux-x64" ;;
    esac
fi

if [ "$target" = "darwin-x64" ]; then
    # Is it rosetta
    sysctl sysctl.proc_translated >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        target="darwin-aarch64"
        echo -e "$Dim Your shell is running in Rosetta 2. Downloading bun for $target instead. $Color_Off"
    fi
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

    if (($?)); then
        echo -e "${Red}error${Color_Off}: Failed to create install directory $bin_dir" 1>&2
        exit 1
    fi
fi

curl --fail --location --progress-bar --output "$exe.zip" "$bun_uri"

if (($?)); then
    echo -e "${Red}error${Color_Off}: Failed to download bun from $bun_uri" 1>&2
    exit 1
fi
unzip -d "$bin_dir" -q -o "$exe.zip"
if (($?)); then
    echo -e "${Red}error${Color_Off}: Failed to extract bun" 1>&2
    exit 1
fi
mv "$bin_dir/bun-${target}/bun" "$exe"
if (($?)); then
    echo -e "${Red}error${Color_Off}: Failed to extract bun" 1>&2
    exit 1
fi
chmod +x "$exe"
if (($?)); then
    echo -e "${Red}error${Color_Off}: Failed to set permissions on bun executable." 1>&2
    exit 1
fi
rmdir $bin_dir/bun-${target}
rm "$exe.zip"

echo -e "${Green}bun was installed successfully to ${BGreen}$exe$Color_Off"

if command -v bun --version >/dev/null; then
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE="true" $exe completions >/dev/null 2>&1

    echo "Run 'bun --help' to get started"
    exit 0
fi

if test $(basename $SHELL) == "fish"; then
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE="true" SHELL="fish" $exe completions >/dev/null 2>&1
    if test -f $HOME/.config/fish/config.fish; then
        echo -e "\n# bun\nset -Ux BUN_INSTALL \"$bun_install\"" >>"$HOME/.config/fish/config.fish"
        echo -e "fish_add_path \"$bin_dir\"\n" >>"$HOME/.config/fish/config.fish"
        echo ""
        echo -e "$Dim Added \"$bin_dir\" to \$PATH in \"\~/.config/fish/config.fish\"$Color_Off"
        echo ""
        echo -e "To get started, run"
        echo -e ""
        echo -e "$Bold   source ~/.config/fish/config.fish$Color_Off"
        echo -e "$Bold   bun --help$Color_Off"
        exit 0
    else
        echo ""
        echo "Manually add the directory to your \$HOME/.config/fish/config.fish (or similar)"
        echo ""
        echo -e "$Bold   set -Ux BUN_INSTALL \"$bun_install\"$Color_Off"
        echo -e "$Bold   fish_add_path \"$bin_dir\"$Color_Off"
        echo ""
    fi
elif
    test $(basename $SHELL) == "zsh"
then
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE="true" SHELL="zsh" $exe completions >/dev/null 2>&1

    if test -f $HOME/.zshrc; then
        echo -e "\n# bun\nexport BUN_INSTALL=\"$bun_install\"" >>"$HOME/.zshrc"
        echo -e "export PATH=\"\$BUN_INSTALL/bin:\$PATH\"" >>"$HOME/.zshrc"
        echo ""
        echo -e "$Dim Added \"$bin_dir\" to \$PATH in \"~/.zshrc\"$Color_Off"

        echo ""
        echo -e "To get started, run"
        echo ""
        echo -e "$Bold   exec $SHELL$Color_Off"
        echo -e "$Bold   bun --help$Color_Off"
        echo ""
        exit 0
    else
        echo ""
        echo "Manually add the directory to your \$HOME/.zshrc (or similar)"
        echo ""
        echo -e "$Bold   export BUN_INSTALL=\"$bun_install\"$Color_Off"
        echo -e "$Bold   export PATH=\"\$BUN_INSTALL/bin:\$PATH\"$Color_Off"
    fi

else
    echo ""
    echo "Manually add the directory to your \$HOME/.bashrc (or similar)"
    echo ""
    echo -e "$Bold  export export BUN_INSTALL=\"$bun_install\"$Color_Off"
    echo -e "$Bold  export export PATH=\"\$BUN_INSTALL/bin:\$PATH\"$Color_Off"
fi
echo ""
echo -e "To get started, run"
echo ""
echo -e "$Bold   bun --help$Color_Off"
