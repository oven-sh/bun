// usage: <bun> conf-js-files.mjs <tests/cases dir> : how many conformance cases hold a JavaScript unit.
import { readFileSync } from "node:fs";
const root = process.argv[2];
let cases = 0, withJs = 0, onlyJs = 0, units = 0;
for (const f of new Bun.Glob("{compiler,conformance}/**/*.{ts,tsx,js,jsx,mjs,cjs}").scanSync({ cwd: root, absolute: true })) {
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  cases++;
  const names = [...text.matchAll(/^\/\/\s*@filename\s*:\s*(\S+)\s*$/gim)].map(m => m[1]);
  if (!names.length) names.push(f);
  const js = names.filter(n => /\.(js|jsx|mjs|cjs)$/i.test(n)).length;
  const code = names.filter(n => /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i.test(n)).length;
  units += js;
  if (js) withJs++;
  if (js && js === code) onlyJs++;
}
console.log(JSON.stringify({ cases, casesWithJavaScriptUnit: withJs, casesWithOnlyJavaScriptUnits: onlyJs, javaScriptUnitsByDirective: units }));
