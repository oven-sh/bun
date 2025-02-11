#!/bin/sh

# This script starts tailscale on the current machine.

execute() {
  echo "$ $@" >&2
  if ! "$@"; then
    echo "Command failed: $@" >&2
    exit 1
  fi
}

main() {
  if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <auth-key>" >&2
    exit 1
  fi

  execute tailscale up --reset --ssh --accept-risk=lose-ssh --auth-key="$1"
}

main "$@"
