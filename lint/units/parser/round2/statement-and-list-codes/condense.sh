#!/bin/sh
# usage: condense.sh out.txt   one line for each input: the source, the first diagnostic of typescript-go, the first line of bun
awk '/^## /{print; next} /^"/{src=$0; next} /^   go /{ if (!(src in seen)) { seen[src]=1; g=$0 } next } /^   bun/{ if (src in seen && !(src in done)) { done[src]=1; sub(/^   go  /,"",g); sub(/^   bun /,"",$0); print src " => " g " || " $0 } }' "$1"
