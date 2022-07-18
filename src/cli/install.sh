#!/usr/bin/env bash
set -euo pipefail

if [[ ${OS:-} = Windows_NT ]]; then
    echo 'error: Please install bun using Windows Subsystem for Linux'
    exit 1
fi

# Reset
Color_Off=''

# Regular Colors
Red=''
Green=''
Dim='' # White

# Bold
Bold_White=''
Bold_Green=''

if [[ -t 1 ]]; then
    # Reset
    Color_Off='\033[0m' # Text Reset

    # Regular Colors
    Red='\033[0;31m'   # Red
    Green='\033[0;32m' # Green
    Dim='\033[0;2m'    # White

    # Bold
    Bold_Green='\033[1;32m' # Bold Green
    Bold_White='\033[1;37m' # Bold White
fi

error() {
    echo -e "${Red}error${Color_Off}:" "$@" >&2
    exit 1
}

command -v unzip >/dev/null ||
    error 'unzip is required to install bun (see: https://github.com/oven-sh/bun#unzip-is-required)'

if [[ $# -gt 1 ]]; then
    error 'Too many arguments, only 1 is allowed, which can be a specific tag of bun to install (e.g. "bun-v0.1.4")'
fi

case $(uname -ms) in
'Darwin x86_64')
    target=darwin-x64
    ;;
'Darwin arm64')
    target=darwin-aarch64
    ;;
'Linux aarch64' | 'Linux arm64')
    target=linux-aarch64
    ;;
'Linux x86_64' | *)
    target=linux-x64
    ;;
esac

if [[ $target = darwin-x64 ]]; then
    # Is this process running in Rosetta?
    if [[ $(sysctl -n sysctl.proc_translated) = 1 ]]; then
        target=darwin-aarch64
        echo -e "${Dim}Your shell is running in Rosetta 2. Downloading bun for $target instead$Color_Off"
    fi
fi

github_repo=https://github.com/Jarred-Sumner/bun-releases-for-updater

if [[ $# = 0 ]]; then
    bun_uri=$github_repo/releases/latest/download/bun-$target.zip
else
    bun_uri=$github_repo/releases/download/$1/bun-$target.zip
fi

install_env=BUN_INSTALL
bin_env=\$$install_env/bin

install_dir=${!install_env:-$HOME/.bun}
bin_dir=$install_dir/bin
exe=$bin_dir/bun

if [[ ! -d $bin_dir ]]; then
    mkdir -p "$bin_dir" ||
        error "Failed to create install directory \"$bin_dir\""
fi

curl --fail --location --progress-bar --output "$exe.zip" "$bun_uri" ||
    error "Failed to download bun from \"$bun_uri\""

unzip -oqd "$bin_dir" "$exe.zip" ||
    error 'Failed to extract bun'

mv "$bin_dir/bun-$target/bun" "$exe" ||
    error 'Failed to move extracted bun to destination'

chmod +x "$exe" ||
    error 'Failed to set permissions on bun executable'

rm -r "$bin_dir/bun-$target" "$exe.zip"

tildify() {
    if [[ ${2:-} = safe ]]; then
        local escaped=${1//"'"/"\\'"}

        if [[ $1 = $HOME/* ]]; then
            echo "${escaped/"$HOME/"/"~/'"}'"
        else
            echo "'$escaped'"
        fi
    else
        echo "${1/"$HOME/"/'~/'}"
    fi
}

echo -e "${Green}bun was installed successfully to $Bold_Green$(tildify "$exe")$Color_Off"

if command -v bun >/dev/null; then
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE=true $exe completions &>/dev/null || :

    echo "Run 'bun --help' to get started"
    exit
fi

refresh_command=''

tilde_bin_dir=$(tildify "$bin_dir")
safe_tilde_install_dir=$(tildify "$install_dir" safe)

echo

case $(basename "$SHELL") in
fish)
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE=true SHELL=fish $exe completions &>/dev/null || :

    commands=(
        "set --export $install_env $safe_tilde_install_dir"
        "set --export PATH $bin_env \$PATH"
    )

    fish_config=$HOME/.config/fish/config.fish
    tilde_fish_config=$(tildify "$fish_config")

    if [[ -w $fish_config ]]; then
        {
            echo -e '\n# bun'

            for command in "${commands[@]}"; do
                echo "$command"
            done
        } >>"$fish_config"

        echo -e "${Dim}Added \"$tilde_bin_dir\" to \$PATH in \"$tilde_fish_config\"$Color_Off"

        refresh_command="source $tilde_fish_config"
    else
        echo "Manually add the directory to $tilde_fish_config (or similar):"
        echo

        for command in "${commands[@]}"; do
            echo -e "  $Bold_White $command$Color_Off"
        done
    fi
    ;;
zsh)
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE=true SHELL=zsh $exe completions &>/dev/null || :

    commands=(
        "export $install_env=$safe_tilde_install_dir"
        "export PATH=\"$bin_env:\$PATH\""
    )

    zsh_config=$HOME/.zshrc
    tilde_zsh_config=$(tildify "$zsh_config")

    if [[ -w $zsh_config ]]; then
        {
            echo -e '\n# bun'

            for command in "${commands[@]}"; do
                echo "$command"
            done
        } >>"$zsh_config"

        echo -e "${Dim}Added \"$tilde_bin_dir\" to \$PATH in \"$tilde_zsh_config\"$Color_Off"

        refresh_command="exec $SHELL"
    else
        echo "Manually add the directory to $tilde_zsh_config (or similar):"
        echo

        for command in "${commands[@]}"; do
            echo -e "  $Bold_White $command$Color_Off"
        done
    fi
    ;;
*)
    echo "Manually add the directory to ~/.bashrc (or similar):"
    echo
    echo -e "  $Bold_White export $install_env=$safe_tilde_install_dir$Color_Off"
    echo -e "  $Bold_White export PATH=\"$bin_env:\$PATH\"$Color_Off"
    ;;
esac

echo
echo -e "To get started, run:$Bold_White"

if [[ $refresh_command ]]; then
    echo -e "   $refresh_command"
fi

echo -e "   bun --help$Color_Off"
