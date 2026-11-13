#!/bin/bash
cd /workspace/bun
for f in $(git diff --name-only 89452d2ac13 HEAD -- src); do [ -f /tmp/base-src/${f#src/} ] && touch /tmp/base-src/${f#src/}; done
unshare -m --propagation private sh -c 'mount --bind /tmp/base-src /workspace/bun/src && cd /workspace/bun && bun bd --version' > /tmp/build-base.log 2>&1
echo "base debug exit=$?" > /tmp/run-base.status
cp build/debug/bun-debug /tmp/bun-main-debug
bash /tmp/measure/symbols.sh /tmp/bun-main-debug /tmp/measure/symbols-main.txt
bash /tmp/measure/counts-of.sh /tmp/bun-main-debug /tmp/measure/symbols-main.txt /tmp/measure/main-counts.txt
for f in $(git diff --name-only 89452d2ac13 HEAD -- src); do [ -f $f ] && touch $f; done
echo done > /tmp/run-base.done
