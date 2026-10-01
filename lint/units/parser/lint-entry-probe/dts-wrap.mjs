// Simulates the preset flag: the file becomes the body of "declare namespace", which parses every statement with
// is_typescript_declare set and without a "declare" keyword of its own.
import { readFileSync, readdirSync, lstatSync, statSync } from "node:fs";
import { join } from "node:path";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const mode = process.argv[2];
const roots = process.argv.slice(3);
function* walk(d, depth = 0) { let es; try { es = readdirSync(d); } catch { return; } for (const e of es) { const p = join(d, e); let s; try { s = lstatSync(p); } catch { continue; } if (s.isSymbolicLink()) continue; if (s.isDirectory()) { if (depth < 14) yield* walk(p, depth + 1); } else yield p; } }
const isDts = n => /\.d\.(ts|mts|cts)$/.test(n) || (/\.ts$/.test(n) && /\.d\./.test(n.split("/").pop()));
const t = new Bun.Transpiler({ loader: "ts" });
function* units() {
  for (const root of roots) for (const file of walk(root)) {
    if (mode === "corpus") {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      let text; try { text = readFileSync(file, "utf8"); } catch { continue; }
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const lines = text.split(/\r?\n/);
      const parts = []; let cur = { name: file.split("/").pop(), lines: [] }; let sawFilename = false;
      for (const line of lines) {
        const m = /^\/\/\s*@filename\s*:\s*(\S+)/i.exec(line);
        if (m) { if (sawFilename || cur.lines.some(l => l.trim().length && !/^\/\/\s*@\w+\s*:/.test(l))) parts.push(cur); cur = { name: m[1], lines: [] }; sawFilename = true; continue; }
        if (/^\/\/\s*@\w+\s*:/.test(line)) continue;
        cur.lines.push(line);
      }
      parts.push(cur);
      for (const part of parts) if (isDts(part.name)) yield [file + " :: " + part.name, part.lines.join("\n")];
    } else {
      if (!/\.d\.(ts|mts|cts)$/.test(file)) continue;
      let src; try { src = readFileSync(file, "utf8"); } catch { continue; }
      if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
      if (src.length > 3_000_000) continue;
      yield [file, src];
    }
  }
}
const res = new Map(); let n = 0;
for (const [name, src] of units()) {
  const sf = ts.createSourceFile("/x.d.ts", src, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) continue;
  n++;
  const input = "declare namespace __ambient {" + src + "\n}";
  let err = null;
  try { t.transformSync(input); } catch (e) { const list = e?.errors?.length ? e.errors : [e]; err = list[0]; }
  if (err === null) continue;
  const key = String(err.message).replace(/"[^"]*"/g, '"…"');
  if (!res.has(key)) res.set(key, []);
  res.get(key).push(name.replace("/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases/", "") + ":" + (err.position?.line ?? "?") + " :: " + (err.position?.lineText ?? "").trim().slice(0, 110));
}
console.log("units that tsc parses:", n, "failing when wrapped:", [...res.values()].reduce((a, b) => a + b.length, 0));
for (const [k, v] of [...res].sort((a, b) => b[1].length - a[1].length)) {
  console.log(String(v.length).padStart(5), k);
  for (const f of v.slice(0, 8)) console.log("        " + f);
}
