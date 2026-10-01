// Research probe: removeTestPathPrefixes and the reference path pattern against the ground truth.
import { removeTestPathPrefixes } from "./prefixes";
const parts = ["/.ts/", "/.lib/", "/.src/", "bundled:///libs/", "file:///./ts/", "file:///./lib/", "file:///./src/", "/.src", "/.s", "/", "//", ".src/", "file://", "file:///", "./", "a.ts", "lib.d.ts", "(1,2): error TS1: ", "/.src/.src/", "/.lib//.src/", "bundled:///libs", "bundled://", "é", "\r\n", " ", "file:///.src/", "/.TS/", "/.Src/", "x/.src/y", "/.ts/.lib/.src/", "reference path", "reference\tpath", "reference\u00a0path", "reference\u000bpath", "reference\npath", "reference\fpath", "reference\rpath", "reference  path", "reference\u2028path", "referencepath", "Reference path", "reference\ufeffpath"];
const inputs: string[] = [...parts];
let seed = 12345;
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let i = 0; i < 20000; i++) {
  let s = "";
  const k = 1 + rnd(6);
  for (let j = 0; j < k; j++) s += parts[rnd(parts.length)];
  inputs.push(s);
}
await Bun.write("/tmp/im/prefix_in.json", JSON.stringify(inputs));
// Usage: bun verify_prefix.ts <binary built from ../groundtruth/prefixes_main.go.txt>
const p = Bun.spawnSync([process.argv[2], "/tmp/im/prefix_in.json", "/tmp/im/prefix_out.json"]);
if (p.exitCode !== 0) throw new Error(p.stderr.toString());
const want = JSON.parse(await Bun.file("/tmp/im/prefix_out.json").text());
let bad = 0, badRe = 0, badJsS = 0;
const re = /reference[\t\n\f\r ]path/;
const jsS = /reference\spath/;
inputs.forEach((s, i) => {
  if (removeTestPathPrefixes(s, false) !== want.a[i] || removeTestPathPrefixes(s, true) !== want.b[i]) { bad++; if (bad < 5) console.log(JSON.stringify(s), JSON.stringify(removeTestPathPrefixes(s, false)), JSON.stringify(want.a[i])); }
  if (re.test(s) !== want.r[i]) badRe++;
  if (jsS.test(s) !== want.r[i]) badJsS++;
});
console.log(JSON.stringify({ inputs: inputs.length, bad, badRe, whereTheJavaScriptClassDiffers: badJsS }));
