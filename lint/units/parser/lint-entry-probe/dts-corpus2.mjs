import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
function* walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) yield* walk(p); else yield p; } }
const isDts = n => /\.d\.(ts|mts|cts)$/.test(n) || (/\.ts$/.test(n) && /\.d\./.test(n.split("/").pop()));
const t = new Bun.Transpiler({ loader: "ts" });
const shapes = new Map();
for (const dir of ["conformance", "compiler"]) {
  for (const file of walk(join(root, dir))) {
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
    for (const part of parts) {
      if (!isDts(part.name)) continue;
      const src = part.lines.join("\n");
      const sf = ts.createSourceFile("/" + part.name.replace(/^.*\//, ""), src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
      if (sf.parseDiagnostics.length) continue;
      let err = null;
      try { t.transformSync(src); } catch (e) { const list = e?.errors?.length ? e.errors : [e]; err = list[0]; }
      if (err === null) continue;
      const msg = String(err.message);
      const pos = err.position;
      const lineText = pos?.lineText ?? "";
      if (/must be initialized/.test(msg)) {
        // find the tsc node at that offset and describe its ancestors
        const off = pos?.offset ?? -1;
        let node = ts.getTokenAtPosition ? ts.getTokenAtPosition(sf, off) : undefined;
        const chain = [];
        for (let n = node; n && n.kind !== ts.SyntaxKind.SourceFile; n = n.parent) {
          if (ts.isVariableStatement(n)) chain.push("VarStmt[" + (n.modifiers?.map(m => ts.SyntaxKind[m.kind]).join(",") ?? "") + "]");
          else if (ts.isModuleDeclaration(n)) chain.push("Module[" + (n.modifiers?.map(m => ts.SyntaxKind[m.kind]).join(",") ?? "") + (n.name.kind === ts.SyntaxKind.StringLiteral ? ",string" : n.flags & ts.NodeFlags.GlobalAugmentation ? ",global" : "") + "]");
          else if (ts.isModuleBlock(n) || ts.isVariableDeclarationList(n) || ts.isVariableDeclaration(n) || ts.isIdentifier(n)) {}
          else chain.push(ts.SyntaxKind[n.kind]);
        }
        const key = chain.join(" < ");
        if (!shapes.has(key)) shapes.set(key, []);
        shapes.get(key).push(file.replace(root + "/", "") + " :: " + part.name + " :: " + lineText.trim());
      } else {
        console.log("OTHER", JSON.stringify(msg), file.replace(root + "/", ""), "::", part.name, "::", JSON.stringify(lineText.trim()), "line", pos?.line);
      }
    }
  }
}
for (const [k, v] of [...shapes].sort((a, b) => b[1].length - a[1].length)) {
  console.log(String(v.length).padStart(4), k);
  for (const f of v.slice(0, 3)) console.log("        " + f);
}
