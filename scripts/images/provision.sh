#!/bin/sh

execute() {
  echo "$ $@" >&2
  if ! "$@"; then
    echo "Command failed: $@" >&2
    exit 1
  fi
}

execute_sudo() {
  execute sudo "$@"
}

enable_passwordless_sudo() {
  echo "${password}" | sudo -S sh -c "mkdir -p /etc/sudoers.d/; echo '${username} ALL=(ALL) NOPASSWD: ALL' | EDITOR=tee visudo /etc/sudoers.d/${username}-nopasswd"
}

enable_auto_login() {
  # https://github.com/xfreebird/kcpassword
  echo "00000000: 1ced 3f4a bcbc ba2c caca 4e82" | sudo xxd -r - /etc/kcpassword
  execute_sudo defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser "${username}"
}

disable_screen_saver() {
  execute_sudo defaults write /Library/Preferences/com.apple.screensaver loginWindowIdleTime 0
  execute defaults -currentHost write com.apple.screensaver idleTime 0
}

disable_screen_lock() {
  execute sysadminctl -screenLock off -password "${password}"
}

disable_sleep() {
  execute_sudo systemsetup -setsleep Off 2>/dev/null
  execute_sudo systemsetup -setdisplaysleep Off 2>/dev/null
  execute_sudo systemsetup -setcomputersleep Off 2>/dev/null
}

main() {
  enable_passwordless_sudo
  enable_auto_login
  disable_screen_saver
  disable_screen_lock
  disable_sleep
}

main
