#!/bin/sh
# Runs the cases of each class of stages.tsv in diag mode with coverage: one profile per class.
# usage: sh run-stages.sh <stages.tsv> [work dir]
W=${2:-/tmp/ctp}
mkdir -p "$W/stages"
cd "$W/tsgo/internal/testrunner"
while IFS="$(printf '\t')" read -r cls rx names; do
  CTP_MODE=diag "$W/testrunner.cover.test" -test.run "^TestSubmodule\$/$rx" -test.count=1 -test.coverprofile="$W/stages/$cls.out" > "$W/stages/$cls.log" 2>&1
  echo "$cls $(tail -2 "$W/stages/$cls.log" | head -1 | cut -c1-40)"
done < "$1"
