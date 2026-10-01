#!/bin/sh
M=/workspace/notes/lint/measure/parser
$M/base/bun /tmp/a1bu/p/tscases-run.mjs /tmp/a1bu/runs/tscases.base.jsonl
$M/head/bun /tmp/a1bu/p/tscases-run.mjs /tmp/a1bu/runs/tscases.head.jsonl
echo TSCASES-DONE
