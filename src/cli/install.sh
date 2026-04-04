#!/bin/sh

# Bun POSIX installation script.
# Specification at https://pubs.opengroup.org/onlinepubs/000095399.

# Safety options.
# -e exits immediately on a failed command.
# -u treats unset variables as an error.
set -eu

# Colors.
# Not all terminals support colors.
if [ -t 1 ]; then
  # ANSI escape codes.
  # These are all bold.
  reset=$(printf '\033[0m')
  white=$(printf '\033[1m')
  green=$(printf '\033[1;32m')
  red=$(printf '\033[1;31m')
else
  reset=''
  white=''
  green=''
  red=''
fi

# Helpers.
info() { printf "${white}%s${reset}\n" "$*"; }
success() { printf "${green}%s${reset}\n" "$*"; }
error() { printf "${red}error${reset}: %s\n" "$*" >&2; exit 1; }

# Is 'unzip' accessible?
command -v unzip >/dev/null 2>&1 || error "unzip is required to install bun"

# Usage.
if [ $# -gt 2 ]; then
  error "Too many arguments, only 2 are allowed. The first can be a specific tag of bun to install. (e.g. \"bun-v0.1.4\") The second can be a build variant of bun to install. (e.g. \"debug-info\")"
fi

# Platform.
platform=$(uname -ms)

# Windows.
# Delegating to the PowerShell installation script,
# if not in a Unix-like environment (e.g. MINGW64).
if [ "${OS:-}" = Windows_NT ]; then
  case "$platform" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *)
      # 'irm' is an alias for the 'Invoke-RestMethod' cmdlet.
      # 'iex' is an alias for the 'Invoke-Expression' cmdlet.
      powershell -c "irm bun.sh/install.ps1|iex"
      exit $?
      ;;
  esac
fi

# Target.
target=''
case "$platform" in
  'Darwin x86_64')                 target=darwin-x64 ;;
  'Darwin arm64')                  target=darwin-aarch64 ;;
  'Linux aarch64'|'Linux arm64')   target=linux-aarch64 ;;
  'Linux x86_64')                  target=linux-x64 ;;
  'Linux riscv64')                 error "Not supported on riscv64" ;;
  MINGW64*ARM64*|MINGW64*aarch64*) target=windows-aarch64 ;;
  MINGW64*)                        target=windows-x64 ;;
  *)                               target=linux-x64 ;;
esac

# Musl.
if echo "$target" | grep -q '^linux-'; then
  is_musl=false
  # Specific check for Alpine Linux.
  if [ -f /etc/alpine-release ]; then
    is_musl=true
  # Generic check for other distributions.
  elif ldd --version 2>&1 | grep -q musl; then
    is_musl=true
  fi
  if [ "$is_musl" = true ]; then
    target="${target}-musl"
  fi
fi

# Rosetta 2 on Apple Silicon.
if [ "$target" = darwin-x64 ]; then
  if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
    target=darwin-aarch64
    info "Your shell is running in Rosetta 2. Downloading bun for $target instead"
  fi
fi

# Repository.
# Kept the original bash installer GITHUB env variable.
REPO="${GITHUB:-https://github.com}/oven-sh/bun"
if [ $# -eq 0 ]; then
  bun_uri="$REPO/releases/latest/download/bun-${target}.zip"
else
  bun_uri="$REPO/releases/download/$1/bun-${target}.zip"
fi

# AVX2 fallback.
# Bun is JIT-compiled.
# Optimized for AVX2 instructions.
case "$target" in
  darwin-x64*)
    if ! sysctl -a 2>/dev/null | grep machdep.cpu | grep -q AVX2; then
      target="${target}-baseline"
    fi
    ;;
  linux-x64*)
    if ! grep -q avx2 /proc/cpuinfo 2>/dev/null; then
      target="${target}-baseline"
    fi
    ;;
esac

# Debug.
exe_name=bun
if [ $# -eq 2 ] && [ "$2" = debug-info ]; then
  target="${target}-profile"
  exe_name=bun-profile
  info "You requested a debug build of bun. More information will be shown if a crash occurs."
fi

# Directories.
install_dir="${BUN_INSTALL:-$HOME/.bun}"
bin_dir="$install_dir/bin"
bin_file="$bin_dir/bun"
mkdir -p "$bin_dir"

# Downloading.
download() {
  url="$1"
  output="$2"
  # Is 'curl' accessible?
  if command -v curl >/dev/null 2>&1; then
    info "Downloading via curl!"
    curl --fail --retry 3 --location --progress-bar --output "$output" "$url" && return 0
  fi
  # Is 'wget' accessible?
  if command -v wget >/dev/null 2>&1; then
    info "Downloading via wget!"
    wget -q -O "$output" "$url" && return 0
  fi
  return 1
}
download "$bun_uri" "$bin_file.zip" || error "Failed to download bun from \"$bun_uri\""

# Extracting and installing.
unzip -oqd "$bin_dir" "$bin_file.zip" || error "Failed to extract bun"
mv "$bin_dir/bun-${target}/$exe_name" "$bin_file" || error "Failed to move extracted bun to destination"
chmod +x "$bin_file" || error "Failed to set permissions on bun executable"
rm -rf "$bin_dir/bun-${target}" "$bin_file.zip"

tildify() { # replaces $HOME with '~' in paths (prettier output.)
  case "$1" in
    "$HOME/"*) printf "%s" "$1" | sed "s|^$HOME/|~/|" ;;
    *) printf "%s" "$1" ;;
  esac
}

success "Bun was installed successfully to $(tildify "$bin_file")"

# Is bun already in $PATH?
if command -v bun >/dev/null 2>&1; then
  IS_BUN_AUTO_UPDATE=true "$bin_file" completions >/dev/null 2>&1 || :
  echo "Run 'bun --help' to get started"
  exit
fi

# Shell integration.
refresh_command=''
tilde_bin_dir="$(tildify "$bin_dir")"

# Preparing the lines to be added to shell config files.
quoted_install_dir="\"$(printf "%s" "$install_dir" | sed 's/"/\\"/g')\""
case "$install_dir" in
  "$HOME"/*) quoted_install_dir="\"\${HOME}${install_dir#$HOME}\"" ;;
esac

# Manual instructions.
manual_instructions() {
  echo "Manually add the directory to your shell config file:"
  info "  export BUN_INSTALL=$quoted_install_dir"
  info "  export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
}

echo
shell=$(basename "$SHELL")

case "$shell" in
  fish)
    IS_BUN_AUTO_UPDATE=true SHELL=fish "$bin_file" completions >/dev/null 2>&1 || :
    fish_config="$HOME/.config/fish/config.fish"
    if [ -w "$fish_config" ]; then
      {
        printf '\n# Bun\n'
        echo "set --export BUN_INSTALL $quoted_install_dir"
        echo "set --export PATH \$BUN_INSTALL/bin \$PATH"
      } >> "$fish_config"
      info "Added \"$tilde_bin_dir\" to \$PATH in \"$(tildify "$fish_config")\""
      refresh_command="source $(tildify "$fish_config")"
    else
      manual_instructions
    fi
    ;;
  zsh)
    IS_BUN_AUTO_UPDATE=true SHELL=zsh "$bin_file" completions >/dev/null 2>&1 || :
    config_updated=false
    for config in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.zshenv" \
                  "${ZDOTDIR:+$ZDOTDIR/.zshrc}" \
                  "${ZDOTDIR:+$ZDOTDIR/.zprofile}" \
                  "${ZDOTDIR:+$ZDOTDIR/.zshenv}"; do
      [ -z "$config" ] && continue
      if [ -w "$config" ]; then
        {
          printf '\n# Bun\n'
          echo "export BUN_INSTALL=$quoted_install_dir"
          echo "export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
        } >> "$config"
        info "Added \"$tilde_bin_dir\" to \$PATH in \"$(tildify "$config")\""
        refresh_command="exec $SHELL"
        config_updated=true
        break
      fi
    done
    if [ "$config_updated" = false ]; then
      manual_instructions
    fi
    ;;
  bash)
    IS_BUN_AUTO_UPDATE=true SHELL=bash "$bin_file" completions >/dev/null 2>&1 || :
    config_updated=false
    for config in "$HOME/.bashrc" "$HOME/.bash_profile" \
                  "${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/.bash_profile}" \
                  "${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/.bashrc}" \
                  "${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/bash_profile}" \
                  "${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/bashrc}"; do
      [ -z "$config" ] && continue
      if [ -w "$config" ]; then
        {
          printf '\n# Bun\n'
          echo "export BUN_INSTALL=$quoted_install_dir"
          echo "export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
        } >> "$config"
        info "Added \"$tilde_bin_dir\" to \$PATH in \"$(tildify "$config")\""
        refresh_command="source $config"
        config_updated=true
        break
      fi
    done
    if [ "$config_updated" = false ]; then
      manual_instructions
    fi
    ;;
  ash|dash)
    IS_BUN_AUTO_UPDATE=true SHELL=ash "$bin_file" completions >/dev/null 2>&1 || :
    profile="$HOME/.profile"
    if [ -w "$profile" ]; then
      {
        printf '\n# Bun\n'
        echo "export BUN_INSTALL=$quoted_install_dir"
        echo "export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
      } >> "$profile"
      info "Added \"$tilde_bin_dir\" to \$PATH in \"$(tildify "$profile")\""
      refresh_command=". $profile"
    else
      manual_instructions
    fi
    ;;
  *)
    manual_instructions
    ;;
esac

# Done!
echo
if [ -n "$refresh_command" ]; then
  info "Run $refresh_command to get started!"
fi
info "Run '$tilde_bin_dir/bun --help' to get started!"

