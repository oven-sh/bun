// node gen.cjs <pragmas|directives> <count> <seed> > out.hex : random texts of fragments, one `name<TAB>hex` per line.
const [mode, countArg, seedArg] = process.argv.slice(2);
let s = (Number(seedArg) >>> 0) || 1;
const rnd = n => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; };
const u = t => Buffer.from(t, "utf8");
const raw = (...b) => Buffer.from(b);
const common = [" ", " ", "\t", "\n", "\n", "\r\n", "\r", "\u2028", "\u2029", "\u00a0", "\ufeff", "\u0085", "\u200b", "\u3000", "\u1680", "\u205f", "\u202f", "\u000b", "\u000c", "//", "///", "////", "/*", "/**", "*/", "*", "/", "@", "x", "\u00e9", "\u4e2d"].map(u)
  .concat([raw(0xff), raw(0xc2), raw(0xe2, 0x80), raw(0x80), raw(0xe2), raw(0xe2, 0x80, 0xa8), raw(0xc4, 0xb0), raw(0xe0, 0x82, 0x85), raw(0xed, 0xa0, 0x80), raw(0xf0, 0x9f, 0x98, 0x80)]);
const pragmas = ["<reference", "<reference ", "<REFERENCE ", "<Reference\t", "<amd-module ", "<referencex", "<reference-", "<", ">", "/>", " />", "path", "types", "lib", "no-default-lib", "resolution-mode", "preserve", "PATH", "Types", "foo", "=", " = ", "\"a.ts\"", "'b'", "\"true\"", "'true'", "'false'", "\"import\"", "'require'", "\"IMPORT\"", "\"\"", "\"x", "'", "\"",
  "@ts-check", "@ts-nocheck", "@TS-Check", "@ts-nocheck-x", "@ts-checkx", "@ts-check.", "@jsx", "@jsxFrag", "@jsxImportSource", "@jsxRuntime", "@JSX", "@jsxRunt\u0130me", "@jsx\u0130mportsource", "@jsx\u212a", "@jsx:", " h", " React.createElement", "classic", "let x;", "#!", "#!/bin/sh", "-->", "a@b", "<<<<<<< a", "======="].map(u);
const directives = ["@ts-ignore", "@ts-expect-error", "@ts-ignor", "@ts-expect-erro", "ts-ignore", "@ts-Ignore", "@ts-ignorex", " @ts-ignore", " @ts-expect-error", "\t@ts-ignore", ";", "let a;", "@@ts-ignore", "@ ts-ignore"].map(u);
const pool = common.concat(mode === "pragmas" ? pragmas : directives, mode === "pragmas" ? pragmas : directives);
const out = [];
for (let i = 0; i < Number(countArg); i++) {
  const n = 1 + rnd(14);
  const parts = [];
  for (let k = 0; k < n; k++) parts.push(pool[rnd(pool.length)]);
  out.push(`f${i}\t${Buffer.concat(parts).toString("hex")}`);
  if (out.length === 20000) { process.stdout.write(out.join("\n") + "\n"); out.length = 0; }
}
if (out.length) process.stdout.write(out.join("\n") + "\n");
