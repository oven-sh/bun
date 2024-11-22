#!/bin/sh

# This script sets the hostname of the current machine.

execute() {
  echo "$ $@" >&2
  if ! "$@"; then
    echo "Command failed: $@" >&2
    exit 1
  fi
}

main() {
  if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <hostname>" >&2
    exit 1
  fi

  if [ -f "$(which hostnamectl)" ]; then
    execute hostnamectl set-hostname "$1"
  else
    echo "Error: hostnamectl is not installed." >&2
    exit 1
  fi
}

main "$@"
