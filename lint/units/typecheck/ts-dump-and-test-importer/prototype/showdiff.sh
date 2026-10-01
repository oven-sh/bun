#!/bin/bash
# usage: showdiff.sh <unit-name> [context]
n="$1"; p=$(grep "^$n=" /tmp/tsdump/corpus.list | cut -f1 | cut -d= -f2)
cd /tmp/tsdump && node -e '
import("./rawdump.mjs").then(async ({rawDump, serialize}) => {
  const { toGo, print, Stats } = await import("./togo.mjs");
  const fs = await import("node:fs");
  let text = fs.readFileSync(process.argv[2], "utf8");
  const d = rawDump("/" + process.argv[1], text);
  const parsed = JSON.parse(serialize(d)); parsed.header = parsed;
  const g = toGo(parsed, text, new Stats(), {});
  fs.writeFileSync("/tmp/tsdump/one.ts.txt", print(g, []).join("\n") + "\n");
});' "$n" "$p"
sed -n '/^root /,$p' "/tmp/tsdump/cout/$n.tsgo.txt" | grep -v "^jsdocDiagnostic " > /tmp/tsdump/one.tsgo.txt
diff -U${2:-1} /tmp/tsdump/one.tsgo.txt /tmp/tsdump/one.ts.txt | head -${3:-40}
echo "--- source: $p"
