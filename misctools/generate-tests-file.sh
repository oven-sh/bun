#!/usr/bin/env bash

cd src
rg -l "^test " --type zig | sed  -e 's/\(.*\)/@import\(\".\/\1"\);/' | sed  '/schema/d' | sed '/deps/d' > /tmp/tests.zig
awk '{printf "const Test%d = %s\ntest { const Foo = Test%d; }\n", NR, $0, NR}' < /tmp/tests.zig > tests.zig
zig fmt tests.zig