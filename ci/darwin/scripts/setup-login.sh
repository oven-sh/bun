#!/bin/sh

# This script generates a /etc/kcpassword file to enable auto-login on macOS.
# Yes, this stores your password in plain text. Do NOT do this on your local machine.

# Sources:
# - https://github.com/xfreebird/kcpassword/blob/master/kcpassword

if [ "$(id -u)" != "0" ]; then
  echo "This script must be run using sudo." >&2
  exit 1
fi

execute() {
  echo "$ $@" >&2
  if ! "$@"; then
    echo "Command failed: $@" >&2
    exit 1
  fi
}

kcpassword() {
  passwd="$1"
  key="7d 89 52 23 d2 bc dd ea a3 b9 1f"
  passwd_hex=$(printf "%s" "$passwd" | xxd -p | tr -d '\n')
  
  key_len=33
  passwd_len=${#passwd_hex}
  remainder=$((passwd_len % key_len))
  if [ $remainder -ne 0 ]; then
    padding=$((key_len - remainder))
    passwd_hex="${passwd_hex}$(printf '%0*x' $((padding / 2)) 0)"
  fi

  result=""
  i=0
  while [ $i -lt ${#passwd_hex} ]; do
    for byte in $key; do
      [ $i -ge ${#passwd_hex} ] && break
      p="${passwd_hex:$i:2}"
      r=$(printf '%02x' $((0x$p ^ 0x$byte)))
      result="${result}${r}"
      i=$((i + 2))
    done
  done

  echo "$result"
}

login() {
  username="$1"
  password="$2"

  enable_passwordless_sudo() {
    execute mkdir -p /etc/sudoers.d/
    echo "${username} ALL=(ALL) NOPASSWD: ALL" | EDITOR=tee execute visudo "/etc/sudoers.d/${username}-nopasswd"
  }

  enable_auto_login() {
    echo "00000000: 1ced 3f4a bcbc ba2c caca 4e82" | execute xxd -r - /etc/kcpassword
    execute defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser "${username}"
  }

  disable_screen_lock() {
    execute sysadminctl -screenLock off -password "${password}"
  }

  enable_passwordless_sudo
  enable_auto_login
  disable_screen_lock
}

if [ $# -ne 2 ]; then
  echo "Usage: $0 <username> <password>" >&2
  exit 1
fi

login "$@"
