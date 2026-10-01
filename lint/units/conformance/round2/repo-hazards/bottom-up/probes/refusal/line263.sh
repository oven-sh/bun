#!/bin/bash
# usage: line263.sh < paths   (paths relative to test/cli/lint/conformance, one a line)
# The refusal of sync.sh line 263 as it could be: every name that the runner of CI or `bun test` takes for a test.
# With taken.txt it prints all 16 lines, with harmless.txt none; the line of 3110ce85cf prints 7 and 1.
rel=test/cli/lint/conformance/
awk -F/ -v p="$rel" '{ b = $NF; l = tolower(b); f = p $0; js = (b ~ /\.[cm]?[jt]sx?$/) }
  (js && (b ~ /\.test/ || b ~ /spec\./)) ||
  (js && (index(f, "js/node/test/parallel/") || index(f, "js/node/test/sequential/") || index(f, "js/bun/test/parallel/"))) ||
  (index(f, "js/node/cluster/test-") && b ~ /\.ts$/) ||
  l ~ /[._](test|spec)\.[cm]?[jt]sx?$/'
