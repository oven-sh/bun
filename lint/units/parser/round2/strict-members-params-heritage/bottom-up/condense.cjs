// usage: node condense.cjs <output of probe.cjs> [group prefix]
// One line for each input: the source, the first line of tsc, the first line of typescript-go where it differs from
// tsc's parser, what bun does, and what a lint parse does when the output has it.
const lines = require("node:fs").readFileSync(process.argv[2], "utf8").split("\n");
const only = process.argv[3];
let cur = null, show = !only;
const flush = () => {
  if (!cur || !show) return;
  const tsc = cur.tsc[0] || "?";
  const tscParser = tsc.startsWith("parses") ? "parses" : tsc;
  const go = cur.go[0] || "";
  const parts = [cur.src, "tsc " + tsc + (cur.tsc.length > 1 && !tsc.startsWith("parses") ? " (+" + (cur.tsc.length - 1) + ")" : "")];
  if (go && go !== tscParser) parts.push("GO " + go);
  parts.push("bun " + (cur.bun.join(" / ") || "?"));
  if (cur.lint.length) parts.push("lint " + cur.lint[0]);
  console.log(parts.join("  ||  "));
};
for (const l of lines) {
  if (l.startsWith("## ")) { flush(); cur = null; show = !only || l.slice(3).startsWith(only); if (show) console.log(l); continue; }
  if (!l.startsWith("   ")) { flush(); cur = { src: l, tsc: [], go: [], bun: [], lint: [] }; continue; }
  if (!cur) continue;
  let m;
  if ((m = /^   tsc (.*)$/.exec(l))) cur.tsc.push(m[1].replace(/^parses; checker /, "parses; checker "));
  else if ((m = /^   go  (.*)$/.exec(l))) cur.go.push(m[1]);
  else if ((m = /^   bun (.*)$/.exec(l))) cur.bun.push(m[1]);
  else if ((m = /^   lint (.*)$/.exec(l))) cur.lint.push(m[1]);
}
flush();
