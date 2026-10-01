#!/bin/sh
# usage: copybin.sh base|head <tree>   copies build/release/{bun,bun-profile,bun-profile.linker-map} to the measure directory and records what they are
which="$1"; tree="$2"
dst=/workspace/notes/lint/measure/parser/$which
info=/workspace/notes/lint/measure/parser/baseline/binaries-a.$which.txt
mkdir -p "$dst"
{
  echo "# $which: tree=$tree rev=$(git -C "$tree" rev-parse HEAD) dirty=[$(git -C "$tree" status --porcelain --untracked-files=no | tr '\n' ';')] copied $(date -u +%FT%TZ)"
  for f in bun bun-profile bun-profile.linker-map; do
    src="$tree/build/release/$f"
    [ -f "$src" ] || { echo "MISSING $src"; continue; }
    a=$(sha256sum "$src" | cut -d' ' -f1)
    if [ -f "$dst/$f" ] && [ "$(sha256sum "$dst/$f" | cut -d' ' -f1)" = "$a" ]; then
      echo "present, same sha256: $dst/$f"
    else
      cp "$src" "$dst/$f.tmp-a.$$" && mv -f "$dst/$f.tmp-a.$$" "$dst/$f" && echo "copied: $dst/$f"
    fi
    echo "sha256 $a  $dst/$f  bytes=$(stat -c %s "$dst/$f")"
  done
  for f in bun bun-profile; do
    echo "$dst/$f --version: $("$dst/$f" --version 2>&1)   --revision: $("$dst/$f" --revision 2>&1)"
  done
  echo "configure.json: $(cat "$tree/build/release/configure.json" 2>/dev/null)"
} > "$info" 2>&1
cat "$info"
