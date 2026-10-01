#!/bin/sh
# base: as soon as the configure of the base build wrote build_options.rs, measure the sizes on the private copy of the base sources;
# when the base build is done, copy its binaries
P=/workspace/notes/lint/units/parser/measure/sizeprobe-a
O=/workspace/notes/lint/measure/parser/baseline/sizes-a
B=/workspace/wt/parser-base/build/release/codegen/build_options.rs
while [ ! -s "$B" ] && [ ! -e /tmp/parser-bb/base-release.done ]; do sleep 20; done
sleep 5
mkdir -p /tmp/parser-bb/base-codegen
if [ -s "$B" ]; then cp "$B" /tmp/parser-bb/base-codegen/build_options.rs; echo "build_options.rs: from the base build" > /tmp/parser-bb/base-codegen/ORIGIN; fi
if [ -s /tmp/parser-bb/base-codegen/build_options.rs ]; then
  SIZEPROBE_REV=e3566be889 /tmp/parser-bb/step.sh base-sizes /tmp/parser-bb/base-tree "$P/run.sh" base /tmp/parser-bb/base-tree /tmp/parser-bb/base-codegen "$O"
fi
while [ ! -e /tmp/parser-bb/base-release.done ]; do sleep 20; done
if grep -q "exit=0" /tmp/parser-bb/base-release.done; then /tmp/parser-bb/copybin.sh base /workspace/wt/parser-base > /tmp/parser-bb/copybin-base.log 2>&1; fi
echo "chain-base finished $(date -u +%FT%TZ)" > /tmp/parser-bb/chain-base.done
