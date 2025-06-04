#!/bin/sh
# wrapper for machine.mjs that makes it easier to create an EC2 box matching our CI test runners
# usage: ./scripts/ci-ec2.sh <distro> <release> <x64|aarch64>

distro="$1"
release="$2"
arch="$3"
shift 3
extra="$@"

if [ "$distro" = windows ]; then
  os=windows
else
  os=linux
fi

if [ "$arch" = x64 ]; then
  if [ "$os" = windows ]; then
    instance_type=c7i.2xlarge
  else
    instance_type=c7i.xlarge
  fi
else
  instance_type=c8g.xlarge
fi

if [ "$TERM" = "xterm-ghostty" ]; then
  ghostty_flag="--feature=xterm-256color"
else
  ghostty_flag=""
fi

# TODO this should be able to use a published image instead of running bootstrap
exec bun scripts/machine.mjs ssh --cloud=aws --os=$os --distro=$distro --release=$release --arch=$arch --instance-type=$instance_type --feature=clone $ghostty_flag
