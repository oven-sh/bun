#!/bin/sh

# This script optimizes macOS for virtualized environments.
# It disables things like spotlight, screen saver, and sleep.

# Sources:
# - https://github.com/sickcodes/osx-optimizer
# - https://github.com/koding88/MacBook-Optimization-Script
# - https://www.macstadium.com/blog/simple-optimizations-for-macos-and-ios-build-agents

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

disable_software_update() {
  execute softwareupdate --schedule off
  execute defaults write com.apple.SoftwareUpdate AutomaticDownload -bool false
  execute defaults write com.apple.SoftwareUpdate AutomaticCheckEnabled -bool false
  execute defaults write com.apple.SoftwareUpdate ConfigDataInstall -int 0
  execute defaults write com.apple.SoftwareUpdate CriticalUpdateInstall -int 0
  execute defaults write com.apple.SoftwareUpdate ScheduleFrequency -int 0
  execute defaults write com.apple.SoftwareUpdate AutomaticDownload -int 0
  execute defaults write com.apple.commerce AutoUpdate -bool false
  execute defaults write com.apple.commerce AutoUpdateRestartRequired -bool false
}

disable_spotlight() {
  execute mdutil -i off -a
  execute mdutil -E /
}

disable_siri() {
  execute launchctl unload -w /System/Library/LaunchAgents/com.apple.Siri.agent.plist
  execute defaults write com.apple.Siri StatusMenuVisible -bool false
  execute defaults write com.apple.Siri UserHasDeclinedEnable -bool true
  execute defaults write com.apple.assistant.support "Assistant Enabled" 0
}

disable_sleep() {
  execute systemsetup -setsleep Never
  execute systemsetup -setcomputersleep Never
  execute systemsetup -setdisplaysleep Never
  execute systemsetup -setharddisksleep Never
}

disable_screen_saver() {
  execute defaults write com.apple.screensaver loginWindowIdleTime 0
  execute defaults write com.apple.screensaver idleTime 0
}

disable_screen_lock() {
  execute defaults write com.apple.loginwindow DisableScreenLock -bool true
}

disable_wallpaper() {
  execute defaults write com.apple.loginwindow DesktopPicture ""
}

disable_application_state() {
  execute defaults write com.apple.loginwindow TALLogoutSavesState -bool false
}

disable_accessibility() {
  execute defaults write com.apple.Accessibility DifferentiateWithoutColor -int 1
  execute defaults write com.apple.Accessibility ReduceMotionEnabled -int 1
  execute defaults write com.apple.universalaccess reduceMotion -int 1
  execute defaults write com.apple.universalaccess reduceTransparency -int 1
}

disable_dashboard() {
  execute defaults write com.apple.dashboard mcx-disabled -boolean YES
  execute killall Dock
}

disable_animations() {
  execute defaults write NSGlobalDomain NSAutomaticWindowAnimationsEnabled -bool false
  execute defaults write -g QLPanelAnimationDuration -float 0
  execute defaults write com.apple.finder DisableAllAnimations -bool true
}

disable_time_machine() {
  execute tmutil disable
}

enable_performance_mode() {
  # https://support.apple.com/en-us/101992
  if ! [ $(nvram boot-args 2>/dev/null | grep -q serverperfmode) ]; then
    execute nvram boot-args="serverperfmode=1 $(nvram boot-args 2>/dev/null | cut -f 2-)"
  fi
}

add_terminal_to_desktop() {
  execute ln -sf /System/Applications/Utilities/Terminal.app ~/Desktop/Terminal
}

main() {
  disable_software_update
  disable_spotlight
  disable_siri
  disable_sleep
  disable_screen_saver
  disable_screen_lock
  disable_wallpaper
  disable_application_state
  disable_accessibility
  disable_dashboard
  disable_animations
  disable_time_machine
  enable_performance_mode
  add_terminal_to_desktop
}

main
