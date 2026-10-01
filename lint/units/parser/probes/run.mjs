// Differential grammar probe: installed release `bun` against tsc 6.0.2.
//
// usage (always with the installed release binary, never a debug build):
//   bun run.mjs                 every group under inputs/
//   bun run.mjs 01 05           only the groups whose file name starts with 01 or 05
//   bun report.mjs              tables and counts from out/*.jsonl
//
// Per input:
//   Bun : Bun.Transpiler transformSync, scan, scanImports; loaders ts and tsx;
//         config "plain" (no tsconfig) and "deco" (experimentalDecorators + emitDecoratorMetadata).
//   tsc : ts.createSourceFile(...).parseDiagnostics as input.ts, input.tsx, input.d.ts;
//         when the parse is clean, the diagnostics of a one-file program filtered to grammar codes
//         (code < 2000, 8000-8999, 17000-17999, 18000-18999). A group names the dialects that get a
//         program (`programs`, default ["ts"]) and whether a second program runs with
//         experimentalDecorators (`decoProgram`).
//
// Classes, per dialect (ts, tsx, dts; Bun has no d.ts mode, its ts result is used for dts):
//   A1  tsc parses, no grammar code, Bun rejects
//   A2  tsc parses, the checker reports a grammar code, Bun rejects
//   A   tsc parses, Bun rejects, no program was run for this dialect
//   B   Bun accepts, the parser of tsc rejects
//   AA  both accept (AAg: the checker of tsc reports a grammar code)
//   RR  both reject
//
// out/<group>.jsonl is not committed: out/raw/<group>.jsonl.gz is the copy that was written with the
// installed release bun named in out/versions.json. `gunzip -k out/raw/*.gz && mv out/raw/*.jsonl out/`
// restores it for report.mjs, clusters.mjs and metadata.mjs.
//
// A worker process does the work and appends one JSON line per input. When the worker dies on an
// input (a crash of the binary under test), the parent records the input as "CRASH" and restarts
// the worker behind it.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_PATH = process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js";
const OUT = join(HERE, "out");
const INPUTS = join(HERE, "inputs");

export const isGrammarCode = code =>
  code < 2000 || (code >= 8000 && code < 9000) || (code >= 17000 && code < 18000) || (code >= 18000 && code < 19000);

export async function loadGroup(file) {
  const mod = await import(join(INPUTS, file));
  const group = mod.default;
  const seen = new Set();
  const cases = [];
  for (const c of group.cases) {
    const key = c.src;
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push(c);
  }
  return { ...group, cases, file };
}

function listGroups(filters) {
  const files = readdirSync(INPUTS)
    .filter(f => f.endsWith(".mjs") && !f.startsWith("_"))
    .sort();
  if (!filters.length) return files;
  return files.filter(f => filters.some(x => f.startsWith(x)));
}

// ───────────────────────────── worker ─────────────────────────────

async function worker(file, start) {
  const ts = (await import(TS_PATH)).default;
  const group = await loadGroup(file);
  const base = file.replace(/\.mjs$/, "");
  const outPath = join(OUT, base + ".jsonl");
  const markPath = join(OUT, base + ".mark");

  const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
  const transpilers = {};
  for (const loader of ["ts", "tsx"]) {
    transpilers[loader] = {
      plain: new Bun.Transpiler({ loader }),
      deco: new Bun.Transpiler({ loader, tsconfig: DECO }),
    };
  }

  const errorsOf = e => {
    const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
    return list.map(x => {
      const p = x?.position;
      return [String(x?.message ?? x), p?.line ?? null, p?.column ?? null, p?.offset ?? null, p?.length ?? null];
    });
  };

  // `ts` and `tsx` hold the result of transformSync without tsconfig: 1, or the list of errors
  // [message, line, column, offset, length]. `tsx` is "=" when it equals `ts`. `var` lists the
  // calls (loader.config.api) whose result differs from transformSync without tsconfig.
  const bunProbe = (src, keepOutput) => {
    const r = {};
    const vary = {};
    for (const loader of ["ts", "tsx"]) {
      let base;
      for (const cfg of ["plain", "deco"]) {
        const t = transpilers[loader][cfg];
        for (const api of ["transformSync", "scan", "scanImports"]) {
          let res;
          try {
            const out = t[api](src);
            res = 1;
            const key = loader + "." + cfg;
            if (api === "transformSync" && (keepOutput === true || keepOutput === key)) (r.out ??= {})[key] = out;
          } catch (e) {
            res = errorsOf(e);
          }
          if (cfg === "plain" && api === "transformSync") {
            base = JSON.stringify(res);
            r[loader] = res;
          } else if (JSON.stringify(res) !== base) {
            vary[`${loader}.${cfg}.${api}`] = res;
          }
        }
      }
    }
    if (JSON.stringify(r.tsx) === JSON.stringify(r.ts)) r.tsx = "=";
    if (Object.keys(vary).length) r.var = vary;
    return r;
  };

  const fmt = d => [
    d.code,
    d.start ?? null,
    d.length ?? null,
    ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  ];

  const DIALECTS = {
    ts: ["/input.ts", ts.ScriptKind.TS],
    tsx: ["/input.tsx", ts.ScriptKind.TSX],
    dts: ["/input.d.ts", ts.ScriptKind.TS],
  };

  const programGrammar = (src, fileName, kind, experimentalDecorators) => {
    const options = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noLib: true,
      noResolve: true,
      types: [],
      jsx: ts.JsxEmit.Preserve,
      noEmit: true,
      skipLibCheck: false,
      experimentalDecorators,
      emitDecoratorMetadata: experimentalDecorators,
    };
    const host = {
      getSourceFile: (name, o) => (name === fileName ? ts.createSourceFile(name, src, o, true, kind) : undefined),
      getDefaultLibFileName: () => "/lib.d.ts",
      writeFile() {},
      getCurrentDirectory: () => "/",
      getCanonicalFileName: f => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: f => f === fileName,
      readFile: f => (f === fileName ? src : undefined),
      directoryExists: () => true,
      getDirectories: () => [],
    };
    const program = ts.createProgram({ rootNames: [fileName], options, host });
    const sf = program.getSourceFile(fileName);
    const all = program.getSemanticDiagnostics(sf).map(fmt);
    return { grammar: all.filter(d => isGrammarCode(d[0])), other: all.filter(d => !isGrammarCode(d[0])).map(d => d[0]) };
  };

  const programs = group.programs ?? ["ts"];
  const tscProbe = src => {
    const r = {};
    for (const [dialect, [fileName, kind]] of Object.entries(DIALECTS)) {
      const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, false, kind);
      const parse = sf.parseDiagnostics.map(fmt);
      const one = { parse };
      if (parse.length === 0 && programs.includes(dialect)) {
        try {
          const a = programGrammar(src, fileName, kind, false);
          one.grammar = a.grammar;
          one.other = a.other;
          if (group.decoProgram) {
            const b = programGrammar(src, fileName, kind, true);
            if (JSON.stringify(a.grammar) !== JSON.stringify(b.grammar)) one.grammarDeco = b.grammar;
          }
        } catch (e) {
          one.grammar = [];
          one.checkerThrew = String(e?.message ?? e).slice(0, 200);
        }
      }
      r[dialect] = one;
    }
    for (const dialect of ["tsx", "dts"]) {
      if (JSON.stringify(r[dialect].parse) === JSON.stringify(r.ts.parse)) r[dialect].parse = "=";
    }
    return r;
  };

  const tscEmit = (src, fileName, extra) => {
    try {
      return ts.transpileModule(src, {
        fileName,
        reportDiagnostics: false,
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.Preserve,
          useDefineForClassFields: false,
          noEmitHelpers: true,
          ...extra,
        },
      }).outputText;
    } catch (e) {
      return "THROWN: " + String(e?.message ?? e).slice(0, 200);
    }
  };

  for (let i = start; i < group.cases.length; i++) {
    writeFileSync(markPath, String(i));
    const c = group.cases[i];
    const keep = group.keepOutput ?? c.keepOutput ?? false;
    const rec = { i, fam: c.fam, src: c.src };
    if (c.note) rec.note = c.note;
    if (c.form !== undefined) rec.form = c.form;
    if (c.ctx !== undefined) rec.ctx = c.ctx;
    rec.bun = bunProbe(c.src, keep);
    rec.tsc = tscProbe(c.src);
    if (group.metadata) {
      rec.emit = {
        loose: tscEmit(c.src, "input.ts", { experimentalDecorators: true, emitDecoratorMetadata: true, strict: false, strictNullChecks: false }),
        strict: tscEmit(c.src, "input.ts", { experimentalDecorators: true, emitDecoratorMetadata: true }),
      };
    } else if (group.emit || c.emit) {
      const js = tscEmit(c.src, "input.ts", {});
      rec.tscJs = js;
      try {
        rec.bunOfTscJs = new Bun.Transpiler({ loader: "js" }).transformSync(js);
      } catch (e) {
        rec.bunOfTscJs = null;
      }
    }
    rec.cls = classify(rec);
    appendFileSync(outPath, JSON.stringify(rec) + "\n");
  }
  writeFileSync(markPath, "done");
}

export function classify(rec) {
  const cls = {};
  for (const dialect of ["ts", "tsx", "dts"]) {
    const bun = dialect === "tsx" && rec.bun.tsx !== "=" ? rec.bun.tsx : rec.bun.ts;
    const bunOk = bun === 1;
    const t = rec.tsc[dialect];
    const parse = t.parse === "=" ? rec.tsc.ts.parse : t.parse;
    const parseOk = parse.length === 0;
    const checked = parseOk && Array.isArray(t.grammar);
    const grammar = checked && t.grammar.length > 0;
    if (bunOk) cls[dialect] = parseOk ? (grammar ? "AAg" : "AA") : "B";
    else cls[dialect] = parseOk ? (checked ? (grammar ? "A2" : "A1") : "A") : "RR";
  }
  return cls;
}

// ───────────────────────────── parent ─────────────────────────────

async function parent(filters) {
  mkdirSync(OUT, { recursive: true });
  const files = listGroups(filters);
  const self = fileURLToPath(import.meta.url);
  const versions = {
    bun: Bun.version + " " + Bun.revision,
    typescript: JSON.parse(readFileSync(join(dirname(dirname(TS_PATH)), "package.json"), "utf8")).version,
    execPath: process.execPath,
  };
  writeFileSync(join(OUT, "versions.json"), JSON.stringify(versions, null, 2) + "\n");
  for (const file of files) {
    const base = file.replace(/\.mjs$/, "");
    const outPath = join(OUT, base + ".jsonl");
    const markPath = join(OUT, base + ".mark");
    writeFileSync(outPath, "");
    const group = await loadGroup(file);
    let start = 0;
    const t0 = performance.now();
    while (start < group.cases.length) {
      writeFileSync(markPath, String(start));
      const proc = Bun.spawnSync({
        cmd: [process.execPath, self, "--worker", file, String(start)],
        stdout: "inherit",
        stderr: "pipe",
        env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
      });
      const mark = existsSync(markPath) ? readFileSync(markPath, "utf8").trim() : "";
      if (mark === "done") break;
      const at = Number(mark);
      const c = group.cases[at];
      const stderr = proc.stderr.toString().slice(-600);
      appendFileSync(
        outPath,
        JSON.stringify({ i: at, fam: c.fam, src: c.src, crash: { exitCode: proc.exitCode, signal: proc.signalCode ?? null, stderr } }) + "\n",
      );
      start = at + 1;
    }
    const ms = Math.round(performance.now() - t0);
    console.log(`${base}: ${group.cases.length} inputs, ${ms} ms`);
  }
}

if (process.argv[2] === "--worker") {
  await worker(process.argv[3], Number(process.argv[4]));
} else if (import.meta.main) {
  await parent(process.argv.slice(2));
}
