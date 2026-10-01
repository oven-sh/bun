// Usage: bun /tmp/gte-probe/meta.mjs <types.txt> [--all] [--forms=prop,param,ret]
// Each line is one type. It is used as a property type, a parameter type and a return type of decorated members.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/workspace/bun/");
const ts = require("typescript");

const lines = readFileSync(process.argv[2], "utf8")
  .split("\n")
  .filter(l => l.length > 0 && !l.startsWith("#"));
const all = process.argv.includes("--all");
const formsArg = (process.argv.find(a => a.startsWith("--forms=")) ?? "--forms=prop,param,ret").slice(8).split(",");

const tm = new Bun.Transpiler({
  loader: "ts",
  tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }),
});

function extract(out, fn) {
  // returns map kind -> argument text
  const res = {};
  const re = new RegExp(fn + '\\w*\\("design:(\\w+)", ', "g");
  let m;
  while ((m = re.exec(out))) {
    let i = re.lastIndex;
    let depth = 1;
    let inStr = null;
    for (; i < out.length; i++) {
      const ch = out[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    res[m[1]] = out.slice(re.lastIndex, i).replace(/\s+/g, " ").replace(/\[ /g, "[").replace(/ \]/g, "]");
  }
  return res;
}

function normTsc(s) {
  if (s === undefined) return "<none>";
  s = s.replace(/typeof \((_\w+) = typeof (\w+) !== "undefined" && ([\w.]+)\) === "function" \? \1 : Object/g, "REF($3)");
  s = s.replace(/typeof \((_\w+) = typeof (\w+) !== "undefined" && \((_\w+) = ([\w.]+)\) !== void 0 && \3\.(\w+)\) === "function" \? \1 : Object/g, "REF($4.$5)");
  return s;
}
function normBun(s) {
  if (s === undefined) return "<none>";
  s = s.replace(/(?:typeof [\w.]+ === "undefined" \|\| )*typeof ([\w.]+) === "undefined" \? Object : ([\w.]+)/g, (m, a, b) => (b === "BigInt" || b === "Symbol" ? b : `REF(${b})`));
  s = s.replace(/\bundefined\b/g, "void 0");
  return s;
}

function tscMeta(src, strict) {
  try {
    const r = ts.transpileModule(src, {
      reportDiagnostics: true,
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        ...(strict === undefined ? {} : { strictNullChecks: strict }),
      },
    });
    const errs = (r.diagnostics ?? []).map(d => "TS" + d.code).join(",");
    return { errs, m: extract(r.outputText, "__metadata") };
  } catch (e) {
    return { errs: "CRASH:" + String(e.message).split("\n").join(" ").slice(0, 60), m: {} };
  }
}

function bunMeta(src) {
  try {
    const out = tm.transformSync(src);
    return { errs: "", m: extract(out, "__legacyMetadataTS") };
  } catch (e) {
    const msg = e?.errors?.length ? e.errors.map(x => x.message).join(" | ") : String(e?.message ?? e);
    return { errs: msg, m: {} };
  }
}

for (const ty of lines) {
  const t = ty.replaceAll("\\n", "\n");
  const forms = {
    prop: [`class C {\n  @d p: ${t};\n}\n`, "type"],
    param: [`class C {\n  @d m(a: ${t}) {}\n}\n`, "paramtypes"],
    ret: [`class C {\n  @d m(): ${t} { return null as any }\n}\n`, "returntype"],
  };
  const rows = [];
  for (const k of formsArg) {
    const [src, key] = forms[k];
    const b = bunMeta(src);
    const c0 = tscMeta(src, false);
    const c1 = tscMeta(src, undefined);
    const bv = b.errs ? "ERR(" + b.errs + ")" : normBun(b.m[key]);
    const v0 = (c0.errs ? "[" + c0.errs + "]" : "") + normTsc(c0.m[key]);
    const v1 = (c1.errs ? "[" + c1.errs + "]" : "") + normTsc(c1.m[key]);
    rows.push({ k, bv, v0, v1 });
  }
  const differs = rows.some(r => r.bv !== r.v0);
  if (all || differs) {
    console.log(`${differs ? "DIFF" : "same"} ${JSON.stringify(t)}`);
    for (const r of rows) {
      const mark = r.bv === r.v0 ? " " : "*";
      console.log(`   ${mark} ${r.k.padEnd(5)} bun=${r.bv}  tsc(snc=off)=${r.v0}${r.v1 !== r.v0 ? "  tsc(default)=" + r.v1 : ""}`);
    }
  }
}
