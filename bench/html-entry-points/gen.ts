// Generates N HTML entry points of one size. Each page loads its own module
// script. --script-kb=<n> makes each script about n KB of code (two lines
// without it), --css gives each page its own stylesheet.
// Usage: bun gen.ts <outdir> <N> [--script-kb=<n>] [--css]
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outdir, nStr = "1000", ...flags] = process.argv.slice(2);
const N = /^\d+$/.test(nStr) ? +nStr : NaN;
let scriptKb = 0;
let css = false;
let usage = !outdir || !(N >= 1 && N <= 99999);
for (const flag of flags) {
  if (flag === "--css") css = true;
  else if (/^--script-kb=\d+(\.\d+)?$/.test(flag)) scriptKb = +flag.slice("--script-kb=".length);
  else usage = true;
}
if (usage || scriptKb > 1024) {
  console.error("usage: bun gen.ts <outdir> <N: 1 to 99999> [--script-kb=<n: 0 to 1024>] [--css]");
  process.exit(1);
}

// A run with a smaller N must not keep the pages of an earlier run, and must not remove what it did not write.
const pagesDir = join(outdir, "pages");
if (existsSync(pagesDir) && readdirSync(pagesDir).some(name => !/^p\d{5}\.(html|ts|css)$/.test(name))) {
  console.error(`${pagesDir} has files that this generator did not write. Use another directory.`);
  process.exit(1);
}
rmSync(pagesDir, { recursive: true, force: true });
mkdirSync(pagesDir, { recursive: true });

function scriptSource(id: string): string {
  let source = `const n: number = 1${id};\nconsole.log("page", n);\n`;
  for (let j = 0; source.length < scriptKb * 1024; j++) {
    source += `
export function op${j}(input: string) {
  const parts = input.split(",").map((s, idx) => ({ s, idx, w: s.length * ${j + 1} }));
  let acc = ${j * 7} + n;
  for (const p of parts) {
    acc = (acc * 31 + p.w + p.idx) % 1000003;
    if (p.s.startsWith("x")) acc ^= ${j * 13 + 1};
  }
  return { op: ${j}, acc, tag: "p${id}-op${j}-" + acc.toString(36) };
}
console.log(op${j}("a,b,xc,d").tag);
`;
  }
  return source;
}

for (let i = 1; i <= N; i++) {
  const id = String(i).padStart(5, "0");
  const link = css ? `<link rel="stylesheet" href="./p${id}.css">` : "";
  writeFileSync(
    join(pagesDir, `p${id}.html`),
    `<!doctype html><html><head><title>p${id}</title>${link}</head><body><script type="module" src="./p${id}.ts"></script></body></html>\n`,
  );
  writeFileSync(join(pagesDir, `p${id}.ts`), scriptSource(id));
  if (css) writeFileSync(join(pagesDir, `p${id}.css`), `.p${id} { color: red; }\n`);
}
console.log(`generated ${N} pages in ${outdir}`);
