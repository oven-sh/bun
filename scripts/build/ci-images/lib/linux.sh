# The helpers every tool script may use. Generated scripts run as root under
# `set -eu`, so a failed command ends the bake.

fail() {
  echo "bootstrap: $*" >&2
  exit 1
}

# download <url> <file>
download() {
  curl --fail --silent --show-error --location --retry 3 --output "$2" "$1"
}

# CI runs every command in a login shell (`sh -elc`), and every login shell
# reads this file.
profile=/etc/profile.d/bun-ci.sh

# add_to_path <directory>
add_to_path() {
  echo "export PATH=\"$1:\$PATH\"" >> "$profile"
  export PATH="$1:$PATH"
}

# set_env <name> <value>
set_env() {
  echo "export $1=\"$2\"" >> "$profile"
  export "$1=$2"
}
