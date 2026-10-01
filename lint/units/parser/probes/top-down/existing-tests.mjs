#!/usr/bin/env bun
// Compares the decorator metadata that the probed bun emits for the sources of the existing tests with what
// tsc emits, tag by tag. A tag that differs is an expectation that encodes the output of bun today.
// usage: bun existing-tests.mjs [--worktree /workspace/wt/parser] [--out results]
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { extractMetadata } from "./runner.mjs";

const argv = process.argv.slice(2);
const flagValue = (name, fallback) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : fallback);
const worktree = flagValue("--worktree", "/workspace/wt/parser");
const outDir = path.resolve(flagValue("--out", path.join(import.meta.dirname, "results")));
const ts = createRequire("/workspace/bun/package.json")("typescript");

function sourcesOf(file) {
  const text = fs.readFileSync(path.join(worktree, file), "utf8");
  // Every test of this file declares a class A: the k-th one is renamed to Ak, so that the targets differ.
  if (!file.includes("bundler_")) {
    const renamed = text
      .split("\n  test(")
      .map((chunk, k) => (k === 0 ? chunk : chunk.replace(/\bA\b/g, `A${k}`)))
      .join("\n  test(");
    return [{ name: file, text: renamed }];
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
  const found = [];
  const visit = node => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && /\.tsx?$/.test(node.name.text)) {
      const init = node.initializer;
      let body = null;
      if (ts.isNoSubstitutionTemplateLiteral(init)) body = init.text;
      else if (ts.isTemplateExpression(init)) body = init.head.text + init.templateSpans.map(s => s.literal.text).join("");
      if (body !== null) {
        const owner = node.parent.parent.parent;
        const title = ts.isCallExpression(owner) && owner.arguments[0] ? owner.arguments[0].getText(sf) : "?";
        found.push({ name: `${file} ${title} ${node.name.text}`, text: body });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function splitTop(list) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = list.slice(start).trim();
  if (last !== "") out.push(last);
  return out;
}

// target of a decorate call -> the texts of the types that the tags come from
function typeTexts(text) {
  const sf = ts.createSourceFile("input.ts", text, ts.ScriptTarget.ESNext, true);
  const map = new Map();
  const visit = node => {
    if (ts.isClassLike(node) && node.name) {
      const cls = node.name.text;
      for (const member of node.members) {
        const params = member.parameters ? member.parameters.filter(p => p.name.getText(sf) !== "this") : [];
        const paramTexts = params.map(p => `${p.dotDotDotToken ? "..." : ""}${p.name.getText(sf)}${p.type ? ": " + p.type.getText(sf) : ""}`);
        if (ts.isConstructorDeclaration(member)) map.set(`${cls}`, { params: paramTexts });
        else if (member.name) {
          const key = `${ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static ? cls : cls + ".prototype"}, "${member.name.getText(sf).replace(/^["']|["']$/g, "")}"`;
          map.set(key, { params: paramTexts, type: member.type ? member.type.getText(sf) : "" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return map;
}

function tscOut(text, strictNullChecks) {
  const compilerOptions = { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext };
  if (strictNullChecks === false) compilerOptions.strictNullChecks = false;
  return ts.transpileModule(text, { compilerOptions, fileName: "input.ts" }).outputText;
}

const rows = [];
let compared = 0;
const bun = new Bun.Transpiler({ loader: "ts", tsconfig: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } } });
const files = ["test/bundler/transpiler/decorator-metadata.test.ts", "test/bundler/bundler_decorator_metadata.test.ts"];
for (const file of files) {
  for (const source of sourcesOf(file)) {
    const texts = typeTexts(source.text);
    // A reference that is guarded (bun) and one that is not (tsc, for a class of the same file) are the same tag.
    const plain = entries => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v.replace(/ref\(([\w.$]+)\)/g, "$1")]));
    const index = list => new Map(list.map(e => [e.target.split(", ").slice(0, 2).join(", "), plain(e.entries)]));
    const b = index(extractMetadata(bun.transformSync(source.text)));
    const strict = index(extractMetadata(tscOut(source.text, undefined)));
    const loose = index(extractMetadata(tscOut(source.text, false)));
    for (const target of new Set([...b.keys(), ...strict.keys()])) {
      for (const key of ["type", "paramtypes", "returntype"]) {
        const vb = b.get(target)?.[key];
        const vs = strict.get(target)?.[key];
        const vl = loose.get(target)?.[key];
        if (key !== "paramtypes") {
          compared++;
          if (vb !== vs || vb !== vl) rows.push([source.name, target, key, "", texts.get(target)?.type ?? "", vb ?? "(none)", vs ?? "(none)", vl ?? "(none)"]);
          continue;
        }
        const lb = vb === undefined ? [] : splitTop(vb.slice(1, -1));
        const ls = vs === undefined ? [] : splitTop(vs.slice(1, -1));
        const ll = vl === undefined ? [] : splitTop(vl.slice(1, -1));
        for (let i = 0; i < Math.max(lb.length, ls.length); i++) {
          compared++;
          if (lb[i] !== ls[i] || lb[i] !== ll[i]) {
            rows.push([source.name, target, key, String(i), texts.get(target)?.params[i] ?? "", lb[i] ?? "(none)", ls[i] ?? "(none)", ll[i] ?? "(none)"]);
          }
        }
      }
    }
  }
}
fs.mkdirSync(outDir, { recursive: true });
const header = "source\ttarget\tkey\tindex\ttype_in_source\tbun\ttsc\ttsc_strictNullChecks_false\n";
fs.writeFileSync(path.join(outDir, "existing-tests.tsv"), header + rows.map(r => r.join("\t")).join("\n") + "\n");
console.log(`compared ${compared} tags, ${rows.length} differ from tsc or from tsc with strictNullChecks false`);
console.log(`of these, ${rows.filter(r => r[5] !== r[7]).length} differ from tsc with strictNullChecks false`);
for (const r of rows.filter(r => r[5] !== r[7])) console.log(r.join(" | "));
