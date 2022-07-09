#!/usr/bin/env bash

rg "@import\(\"(.*\.zig)\"\)" src -r "\$1" --only-matching  -I  | xargs basename | sort | uniq > /tmp/imported-names.txt
find src -iname "*.zig" | xargs basename | sort | uniq > /tmp/all-names.txt
comm -1 -3 /tmp/imported-names.txt /tmp/all-names.txt