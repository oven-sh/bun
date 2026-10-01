#!/bin/sh
M=/workspace/notes/lint/measure/parser
for c in targeted-ext testrows small; do
  for b in base head; do
    $M/$b/bun /tmp/a1bu/p/extra.mjs /tmp/a1bu/gd/corpus.$c.json /tmp/a1bu/runs/extra.$b.$c.jsonl
  done
done
echo EXTRA-DONE
