#!/bin/sh
# usage: run.sh <bin> <reader.js> <fd>
d=$(mktemp -d /tmp/probe-fd/mark.XXXXXX)
MARK_DIR=$d timeout 30 "$1" "/tmp/probe-fd/order/$2" "$3" 2>&1 | tail -3
rm -rf "$d"
