#!/bin/sh
node /tmp/gte/meta-tsc.cjs "$1" > /tmp/gte/meta.tsc.json
bun /tmp/gte/meta-bun.mjs "$1" > /tmp/gte/meta.bun.json
node -e '
const a = JSON.parse(require("fs").readFileSync("/tmp/gte/meta.tsc.json","utf8"));
const b = JSON.parse(require("fs").readFileSync("/tmp/gte/meta.bun.json","utf8"));
const pad = (s, n) => (s + " ".repeat(n)).slice(0, Math.max(n, s.length));
console.log(pad("type", 44) + pad("bun prop", 16) + pad("tsc loose", 16) + pad("tsc strict", 16) + "| " + pad("bun ret", 16) + pad("tsc loose", 16) + pad("tsc strict", 16));
for (let i = 0; i < a.length; i++) {
  const t = a[i], u = b[i];
  const d1 = u.bun_prop === t.loose_prop ? "  " : (u.bun_prop === t.strict_prop ? "s " : "!!");
  const d2 = u.bun_ret === t.loose_ret ? "  " : (u.bun_ret === t.strict_ret ? "s " : "!!");
  console.log(d1 + d2 + " " + pad(JSON.stringify(t.ty), 42) + pad(u.bun_prop, 16) + pad(t.loose_prop, 16) + pad(t.strict_prop, 16) + "| " + pad(u.bun_ret, 16) + pad(t.loose_ret, 16) + pad(t.strict_ret, 16));
}
'
