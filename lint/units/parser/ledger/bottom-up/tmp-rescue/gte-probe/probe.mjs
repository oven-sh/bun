// Usage: bun /tmp/gte-probe/probe.mjs <inputs.txt> [--shape] [--out] [--meta]
// Each line is one TypeScript source. "\n" inside a line is written as the two characters \n.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/workspace/bun/");
const ts = require("typescript");

const file = process.argv[2];
const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter(l => l.length > 0 && !l.startsWith("#"));

const t = new Bun.Transpiler({ loader: "ts" });
const tm = new Bun.Transpiler({
  loader: "ts",
  tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }),
});

function bunParse(src, tr) {
  try {
    const out = tr.transformSync(src);
    return { ok: true, out };
  } catch (e) {
    const msg = e?.errors?.length ? e.errors.map(x => x.message).join(" | ") : String(e?.message ?? e);
    return { ok: false, msg };
  }
}

function tscParse(src) {
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const d = sf.parseDiagnostics;
  return {
    sf,
    ok: d.length === 0,
    msg: d.map(x => `TS${x.code}@${x.start}+${x.length}: ${ts.flattenDiagnosticMessageText(x.messageText, " ")}`).join(" | "),
  };
}

function shape(node) {
  const name = ts.SyntaxKind[node.kind];
  const kids = [];
  node.forEachChild(c => {
    kids.push(shape(c));
  });
  let extra = "";
  if (node.kind === ts.SyntaxKind.Identifier) extra = ":" + node.text;
  if (node.kind === ts.SyntaxKind.TypeOperator) extra = ":" + ts.SyntaxKind[node.operator];
  return kids.length ? `${name}${extra}(${kids.join(", ")})` : `${name}${extra}`;
}

function firstType(sf) {
  let found;
  const visit = n => {
    if (found) return;
    if (ts.isTypeNode(n)) {
      found = n;
      return;
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return found;
}

function tscMeta(src) {
  const r = ts.transpileModule(src, {
    compilerOptions: {
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });
  return [...r.outputText.matchAll(/__metadata\("design:(\w+)", (.*)\)[,\n]/g)].map(m => `${m[1]}=${m[2]}`).join(" ; ");
}

function bunMeta(src) {
  const b = bunParse(src, tm);
  if (!b.ok) return "ERR " + b.msg;
  return [...b.out.matchAll(/__legacyMetadataTS\("design:(\w+)", (.*)\)[,\n]/g)].map(m => `${m[1]}=${m[2]}`).join(" ; ");
}

for (const raw of lines) {
  const src = raw.replaceAll("\\n", "\n");
  const b = bunParse(src, t);
  const c = tscParse(src);
  const tag = b.ok === c.ok ? (b.ok ? "both-ok  " : "both-err ") : b.ok ? "BUN-ONLY " : "TSC-ONLY ";
  console.log(`${tag} ${JSON.stringify(src)}`);
  if (!b.ok) console.log(`      bun: ${b.msg}`);
  if (!c.ok) console.log(`      tsc: ${c.msg}`);
  if (process.argv.includes("--out") && b.ok) console.log(`      out: ${JSON.stringify(b.out)}`);
  if (process.argv.includes("--shape")) {
    const ty = firstType(c.sf);
    if (ty) console.log(`      shape: ${shape(ty)}`);
  }
  if (process.argv.includes("--meta")) {
    console.log(`      bun-meta: ${bunMeta(src)}`);
    console.log(`      tsc-meta: ${tscMeta(src)}`);
  }
}
