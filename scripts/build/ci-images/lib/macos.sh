# The helpers every macOS tool script may use. The generated script runs under
# `set -eu` as the machine's admin user, because Homebrew refuses to run as
# root, and uses `sudo` for what belongs to the system.

fail() {
  echo "bootstrap: $*" >&2
  exit 1
}

# download <url> <file>
download() {
  curl --fail --silent --show-error --location --retry 3 --output "$2" "$1"
}

# What a login shell reads: zsh is the default shell, and scripts/darwin-ci
# looks for the tools with `bash -lc`. A machine is set up again when the
# pins move, so a line is only written once.
add_to_profiles() {
  for file in "$HOME/.profile" "$HOME/.zshrc" "$HOME/.bash_profile"; do
    touch "$file"
    grep -qxF "$1" "$file" || echo "$1" >> "$file"
  done
}

# add_to_path <directory>
add_to_path() {
  add_to_profiles "export PATH=\"$1:\$PATH\""
  export PATH="$1:$PATH"
}

# set_env <name> <value>
set_env() {
  add_to_profiles "export $1=\"$2\""
  export "$1=$2"
}
