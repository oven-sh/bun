#!/bin/sh
# Prints the ported upstream files whose content at a commit is not the one that UPSTREAM_PORTED records. Works on a shallow clone: only the new commit is read.
# usage: sh ported_changed.sh <UPSTREAM_PORTED> <typescript-go clone> <typescript-go commit> <TypeScript clone> <TypeScript commit>
set -e
LIST=$1
changed=0
check() {
  repo=$1; clone=$2; commit=$3
  awk -v r="$repo" '$1 == r && NF == 3 { print $2, $3 }' "$LIST" | while read -r id path; do
    now=$(git -C "$clone" ls-tree "$commit" -- "$path" | awk '{ print $3 }')
    if [ "$now" != "$id" ]; then echo "changed  $repo  $path  ${now:-gone}"; fi
  done
}
check typescript-go "$2" "$3"
check TypeScript "$4" "$5"
echo "go directive of typescript-go: $(git -C "$2" show "$3:go.mod" | awk '$1 == "go" { print $2 }')"
