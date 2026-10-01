// node classify.mjs <corpus tag> : every R>A record of the run gets a verdict of whole tsc and a construct class.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const tag = process.argv[2];
const RES = new Set("break case catch class const continue debugger default delete do else enum export extends finally for function if in instanceof return super switch throw try var while with".split(" "));
const UNDECL = d => (d[0] === 2304 || d[0] === 2503 || d[0] === 2694) && (/'#[\w$]+'/.test(d[3]) || RES.has(/^Cannot find (?:name|namespace) '([^']+)'/.exec(d[3])?.[1]));
// codes that need a declaration, a type or a use; 1108 is the return at the top level, which the base accepts
const NOISE = new Set([2304, 2307, 2503, 2564, 7006, 2693, 1225, 2842, 1108, 2378, 2314, 2315, 2318, 2322, 2339, 2345, 2355, 2391, 2552, 2583, 2584, 2695, 2711, 2749, 7005, 7008, 7010, 7019, 7031, 7034, 2300, 2451, 2365, 2367, 2882, 2635, 1340, 2411]);
const dialect = api => (api.includes(".tsx.") ? "tsx" : "ts");
const legacy = api => /\.(exp|deco)\b/.test(api);
const verdictOf = (r, api) => {
  const key = dialect(api);
  const w = (legacy(api) ? r[key + "L"] : undefined) ?? r[key];
  if (w.parse.length) return { kind: "P", codes: [...new Set(w.parse.map(d => d[0]))] };
  const bad = [...new Set(w.sem.filter(d => !NOISE.has(d[0]) || UNDECL(d)).map(d => (UNDECL(d) ? "undeclarable" : d[0])))];
  return bad.length ? { kind: "S", codes: bad } : { kind: "ok", codes: [] };
};
// head's answer for the form in the alias context
const headAlias = new Map();
if (tag === "small") {
  const text = gunzipSync(readFileSync(`runs/head.${tag}.jsonl.gz`)).toString("utf8");
  for (const line of text.split("\n")) {
    if (!line.startsWith('{"i"')) continue;
    const r = JSON.parse(line);
    if (r.ctx === "alias") headAlias.set(r.t, r.vals[r.res[0]][0] !== "e");
  }
}
const whole = readFileSync(`runs/${tag}.ra-whole.jsonl`, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const has = (r, re) => re.test(r.t ?? r.src);
const hasSrc = (r, re) => re.test(r.src);
const RESW = [...RES].join("|");
function construct(r, v, api) {
  const heritage = r.ctx === "heritage" || r.ctx === "iextends";
  const src = r.src;
  // ---- heritage clauses
  if (heritage && headAlias.get(r.t) === false) {
    if (/^\s*(keyof|readonly|infer)\b\s*(\.\s*[\w$]+\s*|<[^<>]*>\s*)?$/.test(r.t)) return ["V6", "a contextual keyword names the type of a heritage clause"];
    if (/^\s*[\w$]+\s*\n\s*<[^<>]*>$/.test(r.t)) return ["V7", "the type arguments of a heritage element start on the next line"];
    return ["R1", "a heritage clause takes an expression (reread of the entry as an expression)"];
  }
  if (hasSrc(r, /^interface\s+\w+\s+extends\s+[\w.]+\(\)/)) return ["R1", "a heritage clause takes an expression (reread of the entry as an expression)"];
  if (hasSrc(r, /^interface\b[^{]*\bextends\b[^{]*\b(extends|implements)\b/) || hasSrc(r, /^interface\b[^{]*\bimplements\b[^{]*\bextends\b/) || (r.ctx === "iextends" && v.codes.includes(1172))) return ["R13", "an interface has a second extends clause, or extends after implements"];
  if (hasSrc(r, /^interface\s+\w+\s+extends\s*(\w+\s*,\s*)?\{\}$/) || (r.ctx === "iextends" && v.codes.includes(1097))) return ["R13b", "the extends list of an interface is empty or ends with a comma"];
  // ---- constructs of the type grammar, in any context
  if (has(r, /\(\s*(\.\.\.)?[\w$\[{][^()]*=[^>]/) && v.codes.some(c => [2371, 1015, 1048, 1186].includes(c))) return ["R2", "a parameter of a signature has an initializer"];
  if (v.codes.includes(2371)) return ["R2", "a parameter of a signature has an initializer"];
  if (v.codes.includes(2369) || has(r, /\(\s*(public|private|protected|readonly|override)\s+[\w$]/)) return ["R3", "a modifier stands before a parameter that is no parameter property"];
  if (v.codes.some(c => [1017, 1019, 1025, 1096, 1021].includes(c))) return ["R4", "an index signature with a rest, an optional, no or a second parameter, a comma, or no type"];
  if (v.codes.includes(1170)) return ["R5", "a computed property name of a type literal is no entity name"];
  if (v.codes.includes(1247)) return ["R6", "a property of a type literal has an initializer"];
  if (v.codes.includes(1539)) return ["R7", "a bigint names a property of a type literal"];
  if (v.codes.includes(18016)) return ["R8", "a private name names a member of a type literal or an interface"];
  if (v.codes.includes(1183)) return ["R9", "an accessor of a type literal has a body"];
  if (v.codes.includes(8020)) return ["R10", "`.<` stands before the type arguments of a type reference"];
  if (v.codes.includes(5086) || has(r, /\[[^\]]*[\w$]\??:\s*[^\],]*\?\s*[\],]/)) return ["R11", "`?` follows the type of a labeled tuple element"];
  if (has(r, /\bimport\s*\([^)]*\)\s*\.\s*#/)) return ["R12", "a reserved word or a private name is the name of a type"];
  if (v.codes.includes("undeclarable") || v.codes.includes(1110) || v.codes.includes(1034) || has(r, new RegExp(`(^|[^\\w$.'"\`])(${RESW})\\s*($|[;\\]|&,)>])`)) && !has(r, /\.\.\.\s*\w+\s*\??:/)) return ["R12", "a reserved word or a private name is the name of a type"];
  if (v.codes.includes(1276) || v.codes.includes(1243)) return ["R14", "accessor with ? or with declare or readonly, without standard decorators"];
  // ---- valid constructs
  if (hasSrc(r, /^(type|interface|namespace|module)\s+(as|satisfies)\b/)) return ["V1", "as or satisfies names a type alias, an interface or a namespace"];
  if (hasSrc(r, /\babstract\s+declare\s+class\b/)) return ["V2", "abstract stands before declare"];
  if (hasSrc(r, /\benum\s+\w+\s*\{\s*\[/)) return ["V3", "a string in brackets names an enum member"];
  if (hasSrc(r, /\baccessor\s+[#\w$'"\[]/)) return ["V4", "accessor is a modifier without standard decorators"];
  if (has(r, /\bout\b/) && /modifier "out"/.test(r.base[1][0][0])) return ["V5", "out names a type or a type parameter"];
  if (has(r, /\.\.\.\s*(class|const|delete|enum|extends|in|var)\s*\??:/)) return ["V8", "a reserved word is the label of a rest element of a tuple"];
  if (has(r, /\bimport\s*\(/)) return ["V9", "an import type takes type arguments, and `.<` before them"];
  if (has(r, /\basserts\s+[\w$]+\s*\n\s*is\b/)) return ["V10", "the type of an assertion predicate starts on the next line"];
  if (has(r, /\basserts\s+is\b/)) return ["V11", "asserts is T is a predicate about a parameter named asserts"];
  if (has(r, /\(\s*[\[{]/)) return ["V12", "a binding pattern of a signature has a hole, a computed key or a default of a renamed element"];
  if (heritage) return ["V?h", "heritage context, form not classified"];
  return ["??", "not classified"];
}
const INIT = /(\(|,)\s*(\.\.\.)?\s*(\[[^\]]*\]|\{[^}]*\}|[\w$]+)\s*\??\s*(:\s*[\w$\[\]]+\s*)?=(?!>)|\[\s*[\w$]+\s*=\s*\d|\{\s*(\.\.\.)?[\w$]+\s*=\s*\d/;
const first = [];
const formClass = new Map();
for (const r of whole) {
  for (const api of r.apis) {
    const v = verdictOf(r, api);
    let [id, title] = construct(r, v, api);
    if ((id === "??" || id === "V12" || id === "V?h") && INIT.test(r.t ?? r.src) && !/\{\s*[\w$]+\s*:\s*[\w$]+\s*=/.test(r.t ?? r.src)) [id, title] = ["R2", "a parameter of a signature has an initializer"];
    first.push({ r, api, v, id, title });
    const heritage = r.ctx === "heritage" || r.ctx === "iextends";
    if (!heritage && r.t != null && id !== "??") formClass.set(r.t, [id, title]);
  }
}
const table = new Map();
const out = [];
for (let { r, api, v, id, title } of first) {
  const heritage = r.ctx === "heritage" || r.ctx === "iextends";
  if (heritage && headAlias.get(r.t) !== false && !["V6", "V7", "R13", "R13b"].includes(id)) {
    const fc = formClass.get(r.t);
    if (fc && fc[0].startsWith("R")) [id, title] = fc;
    else if (fc && v.kind === "P") [id, title] = ["VB", "a valid construct (" + fc[0] + ") in a type of a heritage clause, where the base reads any type"];
    else [id, title] = ["R1", "a heritage clause takes an expression (reread of the entry as an expression)"];
  }
  const valid = id.startsWith("V");
  const state = valid ? (v.kind === "ok" ? "valid" : id === "VB" ? "valid construct, base-tolerated source" : "valid construct, tsc rejects the source") : id.startsWith("R") ? (v.kind === "ok" ? "RESTORE? tsc reports nothing" : "RESTORE") : "??";
  const key = `${state}\t${id}\t${title}`;
  if (!table.has(key)) table.set(key, { n: 0, src: new Set(), codes: new Map(), ex: r.src, exBase: r.base[1][0][0] });
  const e = table.get(key);
  e.n++;
  e.src.add(r.src);
  const ck = v.kind === "ok" ? "-" : `${v.kind}:${v.codes.join(",")}`;
  e.codes.set(ck, (e.codes.get(ck) ?? 0) + 1);
  out.push({ src: r.src, api, id, state, verdict: ck, ctx: r.ctx, t: r.t });
}
let tot = { RESTORE: [0, new Set()], valid: [0, new Set()], other: [0, new Set()] };
for (const o of out) { const k = o.state.startsWith("RESTORE") ? "RESTORE" : o.state.startsWith("valid") ? "valid" : "other"; tot[k][0]++; tot[k][1].add(o.src); }
console.log(`TOTAL  restore ${tot.RESTORE[0]} rec ${tot.RESTORE[1].size} src | valid ${tot.valid[0]} rec ${tot.valid[1].size} src | unclassified ${tot.other[0]} rec ${tot.other[1].size} src`);
for (const [key, e] of [...table].sort()) {
  const [state, id, title] = key.split("\t");
  console.log(`${state.padEnd(40)} ${id.padEnd(4)} ${String(e.n).padStart(6)} rec ${String(e.src.size).padStart(5)} src  ${title}`);
  console.log(`        e.g. ${JSON.stringify(e.ex).slice(0, 110)}   base: ${e.exBase}`);
  console.log(`        tsc: ${[...e.codes].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} x${n}`).join("  ").slice(0, 230)}`);
}
writeFileSync(`runs/${tag}.classified.jsonl`, out.map(o => JSON.stringify(o)).join("\n") + "\n");
