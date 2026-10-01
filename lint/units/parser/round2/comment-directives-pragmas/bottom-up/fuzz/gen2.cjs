// node gen2.cjs <count> <seed> > out.hex : headers made of comments that are near to pragmas, with noise.
const [countArg, seedArg] = process.argv.slice(2);
let s = (Number(seedArg) >>> 0) || 1;
const rnd = n => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; };
const pick = a => a[rnd(a.length)];
const chance = p => rnd(1000) < p * 1000;
const blanks = () => pick(["", "", " ", " ", "  ", "\t", " \t "]);
const nl = () => pick(["\n", "\n", "\n", "\r\n", "\r", "\u2028", "\u2029", ""]);
const noise = () => pick(["\u00a0", "\ufeff", "\u0085", "\u200b", "\u3000", "\u000b", "\u000c", "@", "/", "*", "*/", "/*", "//", "<", ">", "=", "\"", "'", "-", "x", "\u00e9", "\u0130", "\u212a", "\uFFFD", "\n", " "]);
const argName = () => pick(["path", "path", "types", "types", "lib", "lib", "no-default-lib", "resolution-mode", "resolution-mode", "preserve", "preserve", "PATH", "Types", "LIB", "foo", "factory", "path2", "", "res-mode"]);
const value = () => pick(["a.ts", "b", "node", "dom", "true", "true", "false", "TRUE", "import", "require", "IMPORT", "esm", "", "\u00e9.ts", "x y", "a'b", "a\\\"b"]);
const quoted = () => { const q = pick(["\"", "\"", "'"]); const q2 = chance(0.05) ? pick(["\"", "'", ""]) : q; return q + value() + q2; };
const arg = () => argName() + blanks() + (chance(0.95) ? "=" : "") + blanks() + (chance(0.95) ? quoted() : value());
const reference = () => "<" + pick(["reference", "reference", "reference", "REFERENCE", "Reference", "referencex", "reference-x", "amd-module", ""]) + pick([" ", " ", "\t", "", "  "]) + Array.from({ length: rnd(5) }, () => arg() + pick([" ", " ", "", "\t"])).join("") + pick(["/>", "/>", " />", ">", "", "/ >", "/> trailing", "/> <reference path=\"z\"/>"]);
const check = () => "@" + pick(["ts-check", "ts-nocheck", "ts-nocheck", "TS-NoCheck", "ts-nocheck-x", "ts-checkx", "ts-check.", "ts-check:", "ts-ignore", "ts-expect-error", "jsx h", ""]) + pick(["", " why", "\ttext"]);
const line = () => "//" + pick(["", "/", "/", "/", "//"]) + blanks() + pick([reference, reference, reference, check, check, () => "plain", () => ""])();
const jsxName = () => pick(["jsx", "jsx", "jsxFrag", "jsxfrag", "jsxImportSource", "jsxRuntime", "JSX", "jsxRunt\u0130me", "jsx\u0130mportsource", "jsx\u212a", "jsxx", "jsx:", "ts-check", "ts-nocheck", ""]);
const blockLine = () => blanks() + pick(["", "*", "* ", " * "]) + pick([() => "@" + jsxName() + pick([" ", " ", "  ", "\t", "", "\u00a0", "\u2028"]) + pick(["h", "React.createElement", "preact", "classic", "automatic", "h extra", "", "a@jsx b"]), () => "a@b.c @jsx h", () => "text", () => "@", () => "@ jsx h", () => ""])();
const block = () => "/*" + pick(["", "*", "!", " "]) + Array.from({ length: 1 + rnd(4) }, blockLine).join(pick(["\n", "\n", "\r\n", "\r", "\u2028", " "])) + pick(["*/", "*/", "*/", " */", "", "*", "/"]);
const mutate = t => { if (!chance(0.08)) return t; const a = [...t]; const i = rnd(a.length + 1); if (chance(0.5)) a.splice(i, 0, noise()); else a.splice(i, 1); return a.join(""); };
const out = [];
for (let i = 0; i < Number(countArg); i++) {
  let t = chance(0.1) ? pick(["#!/bin/sh\n", "#!", "#! x\u2028", "\ufeff", "\ufeff#!/x\n", " #!x\n"]) : "";
  const n = rnd(5);
  for (let k = 0; k < n; k++) t += pick(["", "", " ", "\n", "\t", "\u00a0", "\ufeff", "\u0085", "\u200b", "\n\n"]) + mutate(chance(0.65) ? line() + nl() : block() + pick(["", " ", "\n", nl()]));
  t += pick(["", "", "let x;", "let x; // @ts-nocheck\n", "-->\n// @ts-check\n", "/", "/ /", "<<<<<<< a\n// @ts-check\n", "\"use strict\";\n/// <reference path=\"late\"/>\n"]);
  let b = Buffer.from(t, "utf8");
  if (chance(0.03) && b.length > 0) { b = Buffer.from(b); b[rnd(b.length)] = pick([0xff, 0x80, 0xc2, 0xe2, 0x0a, 0x2f]); }
  if (chance(0.02) && b.length > 1) b = b.subarray(0, rnd(b.length));
  out.push(`g${i}\t${b.toString("hex")}`);
  if (out.length === 20000) { process.stdout.write(out.join("\n") + "\n"); out.length = 0; }
}
if (out.length) process.stdout.write(out.join("\n") + "\n");
