#!/bin/sh
# Prints, for each line of inputs.txt, the parse diagnostics of typescript-go (/tmp/rr/parsediag), of tsc 6.0.2 and the
# errors of the `bun` on PATH. A line may start with "js:", "tsx:" or "dts:" for another dialect.
cd "$(dirname "$0")" && bun probe.cjs --file inputs.txt
