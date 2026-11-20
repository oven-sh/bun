#!/usr/bin/env bash
set -euo pipefail

platform=$(uname -ms)

if [[ ${OS:-} = Windows_NT ]]; then
  if [[ $platform != MINGW64* ]]; then
    powershell -c "irm bun.sh/install.ps1|iex"
    exit $?
  fi
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
    Bold_White='\033[1m'    # Bold White
fi

error() {
    echo -e "${Red}error${Color_Off}:" "$@" >&2
    exit 1
}

info() {
    echo -e "${Dim}$@ ${Color_Off}"
}

info_bold() {
    echo -e "${Bold_White}$@ ${Color_Off}"
}

success() {
    echo -e "${Green}$@ ${Color_Off}"
}

command -v unzip >/dev/null ||
    error 'unzip is required to install bun'

if [[ $# -gt 2 ]]; then
    error 'Too many arguments, only 2 are allowed. The first can be a specific tag of bun to install. (e.g. "bun-v0.1.4") The second can be a build variant of bun to install. (e.g. "debug-info")'
fi

case $platform in
'Darwin x86_64')
    target=darwin-x64
    ;;
'Darwin arm64')
    target=darwin-aarch64
    ;;
'Linux aarch64' | 'Linux arm64')
    target=linux-aarch64
    ;;
'MINGW64'*'ARM64'* | 'MINGW64'*'aarch64'*)
    target=windows-aarch64
    ;;
'MINGW64'*)
    target=windows-x64
    ;;
'Linux riscv64')
    error 'Not supported on riscv64'
    ;;
'Linux x86_64' | *)
    target=linux-x64
    ;;
esac

case "$target" in
'linux'*)
    if [ -f /etc/alpine-release ]; then
        target="$target-musl"
    fi
    ;;
esac

if [[ $target = darwin-x64 ]]; then
    # Is this process running in Rosetta?
    # redirect stderr to devnull to avoid error message when not running in Rosetta
    if [[ $(sysctl -n sysctl.proc_translated 2>/dev/null) = 1 ]]; then
        target=darwin-aarch64
        info "Your shell is running in Rosetta 2. Downloading bun for $target instead"
    fi
fi

GITHUB=${GITHUB-"https://github.com"}

github_repo="$GITHUB/oven-sh/bun"

# A pinned older version ($1) may still split haswell/nehalem; probe AVX2 and
# request `-baseline` on miss. Current releases alias that name.
case "$target" in
'darwin-x64'*)
    if [[ $(sysctl -a | grep machdep.cpu | grep AVX2) == '' ]]; then
        target="$target-baseline"
    fi
    ;;
'linux-x64'*)
    if [[ $(cat /proc/cpuinfo | grep avx2) = '' ]]; then
        target="$target-baseline"
    fi
    ;;
esac

exe_name=bun

if [[ $# = 2 && $2 = debug-info ]]; then
    target=$target-profile
    exe_name=bun-profile
    info "You requested a debug build of bun. More information will be shown if a crash occurs."
fi

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

mv "$bin_dir/bun-$target/$exe_name" "$exe" ||
    error 'Failed to move extracted bun to destination'

chmod +x "$exe" ||
    error 'Failed to set permissions on bun executable'

rm -r "$bin_dir/bun-$target" "$exe.zip"

tildify() {
    if [[ $1 = $HOME/* ]]; then
        local replacement=\~/

        echo "${1/$HOME\//$replacement}"
    else
        echo "$1"
    fi
}

success "bun was installed successfully to $Bold_Green$(tildify "$exe")"

if command -v bun >/dev/null; then
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE=true $exe completions &>/dev/null || :

    echo "Run 'bun --help' to get started"
    exit
fi

refresh_command=''

# Appends the `# bun` block to the config file in $1. The remaining arguments
# are the lines of the block, the install dir line first. Returns 1 without a
# write when the file already has the block: the last install dir line in the
# file is this one (a later line for another dir wins in the shell) and the
# other lines are present.
append_shell_config() {
    local config=$1
    shift

    # `export BUN_INSTALL=` or `set --export BUN_INSTALL `: the delimiter keeps
    # a line for BUN_INSTALL_CACHE_DIR or another sibling variable out.
    local rest=${1#*"$install_env"}
    local prefix=${1%%"$install_env"*}$install_env${rest:0:1}
    local line='' last=''
    while IFS= read -r line || [[ -n $line ]]; do
        if [[ $line = "$prefix"* ]]; then
            last=$line
        fi
    done <"$config"

    if [[ $last = "$1" ]]; then
        local missing=false
        for line in "${@:2}"; do
            if ! grep -Fxq -- "$line" "$config"; then
                missing=true
                break
            fi
        done

        if [[ $missing = false ]]; then
            return 1
        fi
    fi

    {
        echo -e '\n# bun'

        for line in "$@"; do
            echo "$line"
        done
    } >>"$config" ||
        error "Failed to write to \"$config\""
}

tilde_bin_dir=$(tildify "$bin_dir")
quoted_install_dir=\"${install_dir//\"/\\\"}\"

if [[ $quoted_install_dir = \"$HOME/* ]]; then
    quoted_install_dir=${quoted_install_dir/$HOME\//\$HOME/}
fi

echo

case $(basename "$SHELL") in
fish)
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE=true SHELL=fish $exe completions &>/dev/null || :

    commands=(
        "set --export $install_env $quoted_install_dir"
        "set --export PATH $bin_env \$PATH"
    )

    fish_config=$HOME/.config/fish/config.fish
    tilde_fish_config=$(tildify "$fish_config")

    if [[ -w $fish_config ]]; then
        if append_shell_config "$fish_config" "${commands[@]}"; then
            info "Added \"$tilde_bin_dir\" to \$PATH in \"$tilde_fish_config\""
        else
            info "\"$tilde_fish_config\" already adds \"$tilde_bin_dir\" to \$PATH"
        fi

        refresh_command="source $tilde_fish_config"
    else
        echo "Manually add the directory to $tilde_fish_config (or similar):"

        for command in "${commands[@]}"; do
            info_bold "  $command"
        done
    fi
    ;;
zsh)
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE=true SHELL=zsh $exe completions &>/dev/null || :

    commands=(
        "export $install_env=$quoted_install_dir"
        "export PATH=\"$bin_env:\$PATH\""
    )

    zsh_config=$HOME/.zshrc
    tilde_zsh_config=$(tildify "$zsh_config")

    if [[ -w $zsh_config ]]; then
        if append_shell_config "$zsh_config" "${commands[@]}"; then
            info "Added \"$tilde_bin_dir\" to \$PATH in \"$tilde_zsh_config\""
        else
            info "\"$tilde_zsh_config\" already adds \"$tilde_bin_dir\" to \$PATH"
        fi

        refresh_command="exec $SHELL"
    else
        echo "Manually add the directory to $tilde_zsh_config (or similar):"

        for command in "${commands[@]}"; do
            info_bold "  $command"
        done
    fi
    ;;
bash)
    # Install completions, but we don't care if it fails
    IS_BUN_AUTO_UPDATE=true SHELL=bash $exe completions &>/dev/null || :

    commands=(
        "export $install_env=$quoted_install_dir"
        "export PATH=\"$bin_env:\$PATH\""
    )

    # A macOS or Git Bash terminal opens a login shell, which reads
    # ~/.bash_profile and never ~/.bashrc. A Linux terminal opens a non-login
    # shell, which reads only ~/.bashrc.
    case $platform in
    Darwin* | MINGW64*)
        bash_configs=(
            "$HOME/.bash_profile"
            "$HOME/.bashrc"
        )
        ;;
    *)
        bash_configs=(
            "$HOME/.bashrc"
            "$HOME/.bash_profile"
        )
        ;;
    esac

    if [[ ${XDG_CONFIG_HOME:-} ]]; then
        bash_configs+=(
            "$XDG_CONFIG_HOME/.bash_profile"
            "$XDG_CONFIG_HOME/.bashrc"
            "$XDG_CONFIG_HOME/bash_profile"
            "$XDG_CONFIG_HOME/bashrc"
        )
    fi

    set_manually=true
    for bash_config in "${bash_configs[@]}"; do
        tilde_bash_config=$(tildify "$bash_config")

        if [[ -w $bash_config ]]; then
            if append_shell_config "$bash_config" "${commands[@]}"; then
                info "Added \"$tilde_bin_dir\" to \$PATH in \"$tilde_bash_config\""
            else
                info "\"$tilde_bash_config\" already adds \"$tilde_bin_dir\" to \$PATH"
            fi

            refresh_command="source $bash_config"
            set_manually=false
            break
        fi
    done

    # A login shell (ssh, tty) reads ~/.bash_profile instead of ~/.bashrc. The
    # distro skeleton ~/.bash_profile sources ~/.bashrc. A hand-written one
    # that does not gets the block too. The pattern matches a `. ~/.bashrc` or
    # `source ~/.bashrc` command outside a comment.
    bash_profile=$HOME/.bash_profile
    if [[ $set_manually = false && $bash_config = "$HOME/.bashrc" && -w $bash_profile ]] &&
        ! grep -Eq '^[^#]*(\.|source)[[:space:]]+[^#]*bashrc' "$bash_profile"; then
        if append_shell_config "$bash_profile" "${commands[@]}"; then
            info "Added \"$tilde_bin_dir\" to \$PATH in \"$(tildify "$bash_profile")\" for login shells"
        fi
    fi

    if [[ $set_manually = true ]]; then
        tilde_bash_config=$(tildify "${bash_configs[0]}")

        echo "Manually add the directory to $tilde_bash_config (or similar):"

        for command in "${commands[@]}"; do
            info_bold "  $command"
        done
    fi
    ;;
*)
    echo 'Manually add the directory to ~/.bashrc (or similar):'
    info_bold "  export $install_env=$quoted_install_dir"
    info_bold "  export PATH=\"$bin_env:\$PATH\""
    ;;
esac

echo
info "To get started, run:"
echo

if [[ $refresh_command ]]; then
    info_bold "  $refresh_command"
fi

info_bold "  bun --help"
