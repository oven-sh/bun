// Compares the decorator metadata of Bun with the one of tsc, from out/11-metadata.jsonl.
//
// usage: bun metadata.mjs            writes out/metadata.table.tsv, out/metadata.diff.tsv, out/metadata.summary.txt
//
// A tag is the normal form of one metadata value:
//   Object String Number Boolean Function Array Promise undefined BigInt Symbol
//   Ref(a.b.c)   a reference to a value that is guarded at run time (both compilers guard, with different tests)
// Bun guards with   typeof X === "undefined" ? Object : X
// tsc guards with   typeof (_a = typeof X !== "undefined" && X) === "function" ? _a : Object
// The two guards differ when X is defined and is not a function. That is outside the grammar and is not counted.
//
// "loose" is tsc with strict: false, strictNullChecks: false. Bun has no strictNullChecks switch and
// implements the loose rule (null and undefined are dropped from a union), so loose is the oracle.
// "strict" is tsc 6.0.2 with its defaults; the column shows where the default of tsc differs.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

// The argument text of every call `name("design:...", <expr>)`, in source order.
export function metadataCalls(js) {
  const out = [];
  const re = /\(\s*"(design:(?:type|paramtypes|returntype))"\s*,/g;
  let m;
  while ((m = re.exec(js))) {
    let i = re.lastIndex;
    let depth = 0;
    let quote = null;
    const start = i;
    for (; i < js.length; i++) {
      const c = js[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    out.push([m[1], js.slice(start, i).trim()]);
  }
  return out;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(last, i));
      last = i + 1;
    }
  }
  const tail = text.slice(last);
  if (tail.trim()) parts.push(tail);
  return parts.map(p => p.trim());
}

const PLAIN = new Set(["Object", "String", "Number", "Boolean", "Function", "Array", "Promise"]);

export function tagOf(expr) {
  const e = expr.replace(/\s+/g, " ").trim();
  if (e.startsWith("[") && e.endsWith("]")) {
    return "[" + splitTopLevel(e.slice(1, -1)).map(tagOf).join(", ") + "]";
  }
  if (e === "undefined" || e === "void 0") return "undefined";
  if (PLAIN.has(e)) return e;
  let m;
  // Bun: typeof a === "undefined" || typeof a.b === "undefined" ? Object : a.b
  if ((m = /^(?:typeof [\w$.]+ === "undefined"(?: \|\| )?)+ \? Object : ([\w$.]+)$/.exec(e))) return refTag(m[1]);
  // tsc, builtin: typeof BigInt === "function" ? BigInt : Object
  if ((m = /^typeof ([\w$]+) === "function" \? \1 : Object$/.exec(e))) return refTag(m[1]);
  // tsc: typeof (_a = typeof X !== "undefined" && X) === "function" ? _a : Object
  if ((m = /^typeof \((_\w+) = typeof ([\w$]+) !== "undefined" && (.*)\) === "function" \? \1 : Object$/.exec(e))) {
    const head = m[2];
    const rest = m[3];
    if (rest === head) return refTag(head);
    // (_a = a.b) !== void 0 && (_b = _a.c) !== void 0 && _b.d
    const temps = new Map();
    let ok = true;
    let last = null;
    for (const piece of rest.split(" && ")) {
      let k;
      if ((k = /^\((_\w+) = ([\w$.]+)\) !== void 0$/.exec(piece))) {
        temps.set(k[1], expand(k[2], temps));
      } else if (/^[\w$.]+$/.test(piece)) {
        last = expand(piece, temps);
      } else ok = false;
    }
    if (ok && last) return refTag(last);
  }
  if (/^[\w$]+(?:\.[\w$]+)*$/.test(e)) return refTag(e);
  return "?(" + e + ")";
}

function expand(path, temps) {
  const dot = path.indexOf(".");
  const head = dot < 0 ? path : path.slice(0, dot);
  return temps.has(head) ? temps.get(head) + (dot < 0 ? "" : path.slice(dot)) : path;
}

// A guarded reference to the global Object is Object at run time.
function refTag(name) {
  if (name === "BigInt" || name === "Symbol" || name === "Object") return name;
  return `Ref(${name})`;
}

export function tagsOf(js) {
  if (typeof js !== "string") return null;
  const r = {};
  for (const [key, expr] of metadataCalls(js)) {
    const k = key.slice("design:".length);
    const tag = tagOf(expr);
    if (r[k] === undefined) r[k] = tag;
    else if (Array.isArray(r[k])) r[k].push(tag);
    else r[k] = [r[k], tag];
  }
  return r;
}

// Keys in a fixed order: Bun writes paramtypes before type for a setter, tsc writes type first.
const KEYS = ["type", "paramtypes", "returntype"];
const show = t =>
  t === null
    ? "REJECTED"
    : Object.keys(t).length
      ? KEYS.filter(k => t[k] !== undefined)
          .map(k => `${k}=${Array.isArray(t[k]) ? t[k].join(" ; ") : t[k]}`)
          .join("  ")
      : "(none)";

// The cause of a difference, from the form and the position. The rules are listed from the most specific.
export function causeOf(rec, bun, loose) {
  const form = rec.form ?? "";
  const ctx = rec.ctx;
  if (bun === null) return "bun-rejects";
  if (["paramDecorated", "paramDecoratedRet", "paramBeforeDecorated", "paramAfterDecorated", "ctorParamDecorated", "ctorParamBeforeDecorated"].includes(ctx)) {
    return "outside the grammar: parameter decorator (parse_fn.rs:289-295 and :375-377 read a type for metadata only when a decorator was seen before it)";
  }
  if (ctx === "restParam" || ctx === "restArrayParam") return "outside the grammar: rest parameter (parse_fn.rs:299-302 never reads metadata; tsc serializes the element type)";
  if (ctx === "declareProp") return "outside the grammar: decorated declare field (Bun emits no metadata call)";
  if (ctx === "getterSetter") return "outside the grammar: decorated getter that has a setter (p.rs:7843-7852 writes [] for a getter; tsc writes the parameter type of the setter)";
  if (ctx === "plain") return "outside the grammar: no type form (position or symbol resolution)";
  const stripped = form
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .trim();
  const lead = stripped.replace(/^[(|&\s]+/, "");
  if (/^asserts\s+[\w$]+/.test(lead) && !/^asserts\s*[.<]/.test(lead)) return "type predicate: asserts x / asserts x is T (Bun: Object, tsc: undefined)";
  if (/^(this|[\w$]+)\s+is\b/.test(lead)) return "type predicate: x is T / this is T (Bun: reference to x or Object, tsc: Boolean)";
  if (/\b(a|this)\s+is\b|\basserts\s+[\w$]+/.test(topLevel(stripped))) return "type predicate inside another type (tsc parses it only at the top of a return type)";
  if (/^(any|unknown|never|string|number|boolean|bigint|symbol|object|undefined)\s*\./.test(lead)) return "tree shape: keyword followed by '.' is a type reference (parser.go:2804-2811)";
  const hasCond = /\bextends\b[^?]*\?/.test(stripped);
  if (hasCond) {
    const before = stripped.slice(0, stripped.search(/\bextends\b/));
    const top = topLevel(before);
    if (/[|&]/.test(top.replace(/^\s*[|&]/, ""))) return "tree shape: operand of | or & swallows extends ? :";
    if (/^\s*(keyof|readonly|unique)\b/.test(top)) return "tree shape: operand of keyof / readonly / unique swallows extends ? :";
    const afterColon = falseBranch(stripped);
    if (afterColon !== null && /[|&]/.test(topLevel(afterColon).replace(/^\s*[|&]/, ""))) return "tree shape: level of the false branch (the metadata sink reads it at Level::BitwiseAnd)";
    return "merge rule: a conditional type merges its branches as an intersection (tsc: as a union of the two branches)";
  }
  if (/^(const|abstract|asserts)\b/.test(lead) && !/^abstract\s+new\b/.test(lead)) return "name read as a modifier: const / abstract / asserts as a type name leave no tag (Bun: Object, tsc: reference)";
  if (/^unique\s+symbol\s*\[|^unique\s+(?!symbol\b)/.test(lead)) return "tree shape: operand of unique (tsc: TypeOperator over the whole postfix type)";
  if (/^readonly\b/.test(lead)) return "readonly operand: the sink answers Array for every operand (tsc serializes the operand; differs only where tsc reports TS1354)";
  if (/\bimport\s*\(|\bunique\s+symbol\b|\binfer\s+[\w$]+/.test(stripped)) return "form without a tag: import type, unique symbol and infer leave MNone, which | and & treat as absent and [] as an array";
  if (/\bObject\b/.test(stripped)) return "outside the grammar: a reference named Object (Bun decides on the name, tsc on the resolved symbol)";
  return "other";
}

function topLevel(text) {
  let depth = 0;
  let out = "";
  for (const c of text) {
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out;
}

function falseBranch(text) {
  let depth = 0;
  let q = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === "?") q++;
    else if (depth === 0 && c === ":" && q > 0) {
      q--;
      if (q === 0) return text.slice(i + 1);
    }
  }
  return null;
}

if (import.meta.main) {
  const recs = readFileSync(join(OUT, "11-metadata.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l));
  const table = ["input\tform\tposition\tbun\ttsc-loose\ttsc-strict\tsame"];
  const diff = ["cause\tform\tposition\tinput\tbun (old)\ttsc loose\ttsc strict"];
  const counts = { total: 0, bunRejects: 0, tscRejects: 0, bothAccept: 0, same: 0, differ: 0, strictOnly: 0, unparsed: 0 };
  const byCause = new Map();
  for (const r of recs) {
    counts.total++;
    if (r.crash) continue;
    const tscOk = r.tsc.ts.parse.length === 0;
    const bunOk = r.bun.var?.["ts.deco.transformSync"] === undefined ? r.bun.ts === 1 : r.bun.var["ts.deco.transformSync"] === 1;
    const bun = bunOk ? tagsOf(r.bun.out?.["ts.deco"]) : null;
    if (!tscOk) {
      counts.tscRejects++;
      continue;
    }
    const loose = tagsOf(r.emit.loose);
    const strict = tagsOf(r.emit.strict);
    if (!bunOk) {
      counts.bunRejects++;
      table.push([JSON.stringify(r.src), JSON.stringify(r.form ?? ""), r.ctx, "REJECTED", show(loose), show(strict), "-"].join("\t"));
      continue;
    }
    counts.bothAccept++;
    const text = show(bun) + show(loose) + show(strict);
    if (text.includes("?(")) counts.unparsed++;
    const same = show(bun) === show(loose);
    table.push([JSON.stringify(r.src), JSON.stringify(r.form ?? ""), r.ctx, show(bun), show(loose), show(strict), same ? "yes" : "NO"].join("\t"));
    if (same) {
      counts.same++;
      if (show(loose) !== show(strict)) counts.strictOnly++;
      continue;
    }
    counts.differ++;
    const cause = causeOf(r, bun, loose);
    if (!byCause.has(cause)) byCause.set(cause, []);
    byCause.get(cause).push(r);
    diff.push([cause, JSON.stringify(r.form ?? ""), r.ctx, JSON.stringify(r.src), show(bun), show(loose), show(strict)].join("\t"));
  }
  writeFileSync(join(OUT, "metadata.table.tsv"), table.join("\n") + "\n");
  writeFileSync(join(OUT, "metadata.diff.tsv"), diff.join("\n") + "\n");
  const lines = [];
  lines.push(`inputs ${counts.total}`);
  lines.push(`tsc rejects ${counts.tscRejects}; tsc parses and Bun rejects ${counts.bunRejects}; both accept ${counts.bothAccept}`);
  lines.push(`both accept: same as tsc loose ${counts.same} (of these ${counts.strictOnly} differ from tsc strict), differ ${counts.differ}, values that did not normalise ${counts.unparsed}`);
  lines.push("");
  lines.push("differences by cause (distinct forms / records):");
  for (const [cause, list] of [...byCause].sort((a, b) => b[1].length - a[1].length)) {
    const forms = new Set(list.map(r => r.form ?? r.src));
    lines.push(`  ${forms.size} / ${list.length}  ${cause}`);
  }
  writeFileSync(join(OUT, "metadata.summary.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}
