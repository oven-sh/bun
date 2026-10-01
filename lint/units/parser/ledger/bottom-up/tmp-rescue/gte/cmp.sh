#!/bin/sh
# usage: cmp.sh inputs.json
node /tmp/gte/tsc-parse.cjs "$1" > /tmp/gte/tsc.out.json
bun /tmp/gte/bun-parse.mjs "$1" > /tmp/gte/bun.out.json
node -e '
const a = JSON.parse(require("fs").readFileSync("/tmp/gte/tsc.out.json","utf8"));
const b = JSON.parse(require("fs").readFileSync("/tmp/gte/bun.out.json","utf8"));
for (let i = 0; i < a.length; i++) {
  const t = a[i], u = b[i];
  const tag = t.ok === u.ok ? (t.ok ? "both-accept " : "both-reject ") : (t.ok ? "TSC-ONLY    " : "BUN-ONLY    ");
  console.log(tag + JSON.stringify(t.src) + (t.ok ? "" : "   tsc: " + t.diags[0]) + (u.ok ? "" : "   bun: " + u.err));
}
'
