#!/bin/sh

# This script generates the boot commands for the macOS installer GUI.
# It is run on your local machine, not inside the VM.

# Sources:
# - https://github.com/cirruslabs/macos-image-templates/blob/master/templates/vanilla-sequoia.pkr.hcl

if ! [ "${release}" ] || ! [ "${username}" ] || ! [ "${password}" ]; then
  echo "Script must be run with variables: release, username, and password" >&2
  exit 1
fi

# Hello, hola, bonjour, etc.
echo "<wait60s><spacebar>"

# Select Your Country and Region
echo "<wait30s>italiano<esc>english<enter>"
echo "<wait30s>united states<leftShiftOn><tab><leftShiftOff><spacebar>"

# Written and Spoken Languages
echo "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>"

# Accessibility
echo "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>"

# Data & Privacy
echo "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>"

# Migration Assistant
echo "<wait10s><tab><tab><tab><spacebar>"

# Sign In with Your Apple ID
echo "<wait10s><leftShiftOn><tab><leftShiftOff><leftShiftOn><tab><leftShiftOff><spacebar>"

# Are you sure you want to skip signing in with an Apple ID?
echo "<wait10s><tab><spacebar>"

# Terms and Conditions
echo "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>"

# I have read and agree to the macOS Software License Agreement
echo "<wait10s><tab><spacebar>"

# Create a Computer Account
echo "<wait10s>${username}<tab><tab>${password}<tab>${password}<tab><tab><tab><spacebar>"

# Enable Location Services
echo "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>"

# Are you sure you don't want to use Location Services?
echo "<wait10s><tab><spacebar>"

# Select Your Time Zone
echo "<wait10s><tab>UTC<enter><leftShiftOn><tab><leftShiftOff><spacebar>"

# Analytics
echo "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>"

# Screen Time
echo "<wait10s><tab><spacebar>"

# Siri
echo "<wait10s><tab><spacebar><leftShiftOn><tab><leftShiftOff><spacebar>"

# Choose Your Look
echo "<wait10s><leftShiftOn><tab><leftShiftOff><spacebar>"

if [ "${release}" = "13" ] || [ "${release}" = "14" ]; then
  # Enable Voice Over
  echo "<wait10s><leftAltOn><f5><leftAltOff><wait5s>v"
else
  # Welcome to Mac
  echo "<wait10s><spacebar>"

  # Enable Keyboard navigation
  echo "<wait10s><leftAltOn><spacebar><leftAltOff>Terminal<enter>"
  echo "<wait10s>defaults write NSGlobalDomain AppleKeyboardUIMode -int 3<enter>"
  echo "<wait10s><leftAltOn>q<leftAltOff>"
fi

# Now that the installation is done, open "System Settings"
echo "<wait10s><leftAltOn><spacebar><leftAltOff>System Settings<enter>"

# Navigate to "Sharing"
echo "<wait10s><leftAltOn>f<leftAltOff>sharing<enter>"

if [ "${release}" = "13" ]; then
  # Navigate to "Screen Sharing" and enable it
  echo "<wait10s><tab><down><spacebar>"

  # Navigate to "Remote Login" and enable it
  echo "<wait10s><tab><tab><tab><tab><tab><tab><spacebar>"

  # Open "Remote Login" details
  echo "<wait10s><tab><spacebar>"

  # Enable "Full Disk Access"
  echo "<wait10s><tab><spacebar>"

  # Click "Done"
  echo "<wait10s><leftShiftOn><tab><leftShiftOff><leftShiftOn><tab><leftShiftOff><spacebar>"

  # Disable Voice Over
  echo "<leftAltOn><f5><leftAltOff>"
elif [ "${release}" = "14" ]; then
  # Navigate to "Screen Sharing" and enable it
  echo "<wait10s><tab><tab><tab><tab><tab><spacebar>"

  # Navigate to "Remote Login" and enable it
  echo "<wait10s><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><spacebar>"

  # Disable Voice Over
  echo "<leftAltOn><f5><leftAltOff>"
elif [ "${release}" = "15" ]; then  
  # Navigate to "Screen Sharing" and enable it
  echo "<wait10s><tab><tab><tab><tab><tab><spacebar>"

  # Navigate to "Remote Login" and enable it
  echo "<wait10s><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><tab><spacebar>"
fi

# Quit System Settings
echo "<wait10s><leftAltOn>q<leftAltOff>"
