// Lists what the existing tests pin about TypeScript sources: a rejection (with its message) or an acceptance.
//
//   bun pinned.mjs <recorded calls .jsonl[.gz]> <out pinned.jsonl> [repository root, default /workspace/wt/parser]
//
// Two sources of rows:
//   calls   every recorded call of Bun.Transpiler with loader ts or tsx (record-transpiler-calls.js, a run in which
//           every test passed): a call that threw is a pinned rejection, a call that returned a pinned acceptance
//   static  every itBundled case under test/bundler that has bundleErrors: the TypeScript files of the case
//           whose name has an entry in bundleErrors (pinned rejection by the bundler, messages as written)
// Row: {"src","loader","pin":"reject"|"accept","messages":[...],"at":"file:line","from":"calls"|"static","method"}
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { readLines } from "./lib.mjs";

const [callsPath, outPath, rootArg] = process.argv.slice(2);
if (!callsPath || !outPath) {
  console.error("usage: bun pinned.mjs <calls.jsonl[.gz]> <out pinned.jsonl> [repository root]");
  process.exit(1);
}
const ROOT = rootArg ?? "/workspace/wt/parser";
const ts = createRequire(import.meta.url)(join(ROOT, "node_modules/typescript/lib/typescript.js"));
const rows = [];
const seen = new Set();
const push = r => {
  const key = JSON.stringify([r.src, r.loader, r.pin, r.at, r.messages]);
  if (seen.has(key)) return;
  seen.add(key);
  rows.push(r);
};

let calls = 0;
for (const line of readLines(callsPath)) {
  const c = JSON.parse(line);
  if (c.loader !== "ts" && c.loader !== "tsx") continue;
  if (typeof c.code !== "string") continue;
  calls++;
  push({
    src: c.code,
    loader: c.loader,
    pin: c.ok ? "accept" : "reject",
    messages: c.ok ? [] : c.errors,
    at: c.file ? `${c.file}:${c.line}` : "(async call, no frame)",
    from: "calls",
    method: c.method,
    deco: !!c.deco,
  });
}

const literal = node => {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
};
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.test\.[cm]?[jt]sx?$/.test(name)) out.push(p);
  }
}
const testFiles = [];
if (existsSync(join(ROOT, "test/bundler"))) walk(join(ROOT, "test/bundler"), testFiles);
let staticCases = 0;
for (const path of testFiles) {
  const text = readFileSync(path, "utf8");
  if (!text.includes("bundleErrors")) continue;
  const file = relative(ROOT, path);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = node => {
    if (ts.isCallExpression(node) && /^itBundled(\.\w+)?$/.test(node.expression.getText()) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      const props = Object.fromEntries(node.arguments[1].properties.filter(p => p.name).map(p => [p.name.getText().replace(/["']/g, ""), p]));
      if (props.bundleErrors && props.files && props.bundleErrors.initializer?.properties && props.files.initializer?.properties) {
        const files = {};
        for (const f of props.files.initializer.properties) {
          const name = literal(f.name) ?? f.name?.getText();
          const value = literal(f.initializer);
          if (name && value !== undefined) files[name] = value;
        }
        for (const e of props.bundleErrors.initializer.properties) {
          const name = literal(e.name) ?? e.name?.getText();
          if (!name || files[name] === undefined || !/\.(ts|tsx|mts|cts)$/.test(name)) continue;
          const messages = e.initializer.elements?.map(x => literal(x) ?? x.getText()) ?? [];
          const line = sf.getLineAndCharacterOfPosition(e.getStart()).line + 1;
          staticCases++;
          push({ src: files[name], loader: name.endsWith(".tsx") ? "tsx" : "ts", pin: "reject", messages, at: `${file}:${line}`, from: "static", method: "bundle" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
writeFileSync(outPath, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
const count = f => rows.filter(f).length;
console.log(`pinned: ${rows.length} rows from ${calls} recorded calls with loader ts or tsx and ${staticCases} bundleErrors entries of TypeScript files (${testFiles.length} test files under test/bundler scanned)`);
console.log(`  rejections ${count(r => r.pin === "reject")} (calls ${count(r => r.pin === "reject" && r.from === "calls")}, static ${count(r => r.from === "static")}), acceptances ${count(r => r.pin === "accept")}`);
