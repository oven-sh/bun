// What the bun that runs this file does with every row of rows.json, with the loader and the options of the row.
// usage: <bun under test> side.mjs rows.json <out.json>
import { readFileSync, writeFileSync } from "node:fs";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const T = {
  js: new Bun.Transpiler({ loader: "js" }),
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }),
};
// The value that the output passes for design:<key>, on one line, as the test files read it.
function design(code, key) {
  const match = new RegExp(`\\("design:${key}", ([^]*?)\\),?\\n`).exec(code);
  if (!match) return null;
  return match[1].replace(/\s+/g, " ").replace(/^\[ /, "[").replace(/ \]$/, "]");
}
const out = rows.map(r => {
  try {
    const text = T[r.loader].transformSync(r.src);
    return { got: ["o", text], design: r.key ? design(text, r.key) : undefined };
  } catch (e) {
    const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
    return { got: ["e", list.map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null])] };
  }
});
writeFileSync(process.argv[3], JSON.stringify({ version: Bun.version, revision: Bun.revision, rows: out }));
let rejects = 0, passes = 0, other = 0;
rows.forEach((r, i) => {
  const v = out[i];
  if (v.got[0] === "e") rejects++;
  else if (r.key ? v.design === r.expected : v.got[1] === r.expected) passes++;
  else other++;
});
console.log(`${Bun.version} ${Bun.revision}: ${rows.length} rows, ${rejects} rejected, ${passes} as the test expects, ${other} accepted with another output or value`);
