#!/bin/sh
d=$(mktemp -d /tmp/probe-fd/mark.XXXXXX)
MARK_DIR=$d timeout 60 "$1" /tmp/probe-fd/order/r5-reader.js "$2" "$3" "$4" 2>&1 | tail -2
rm -rf "$d"
