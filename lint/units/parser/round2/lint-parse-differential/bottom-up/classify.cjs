// Classes A and B of join2 files by who reads the place of the difference in a lint parse.
//   node classify.cjs <A|B> <join2.jsonl>... [--ex=2] [--where=<name>]
// The place is the offset of the first error of the lint parse (A) or of the first diagnostic of tsc (B), looked up in the tree of tsc:
//   alias-body            the type of a type alias: skip_type_script_type_stmt reads it with the Discard sink
//   interface-body        the members of an interface: parse_object_type_members, Discard
//   interface-heritage    an entry of "extends" of an interface: parse_type_heritage_clause_element, a type first, Discard
//   class-index-signature the type of an index signature of a class, Discard
//   class-implements      an entry of "implements" of a class: lint_class_implements_entry, a type reference first, else an expression
//   class-extends         the entry of "extends" of a class: lint_class_extends, an expression
//   built                 everything else: the Build sink for types, the expression and statement grammar for the rest
// Rows inside a place: A by what tsc as a whole reports, B by the first diagnostic of tsc.
const fs = require("fs");
const readline = require("readline");
const ts = require(process.env.ORACLE_TYPESCRIPT ?? "/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const args = process.argv.slice(2);
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const [cls, ...files] = args.filter(a => !a.startsWith("--"));
const nex = Number(flag("ex", "2"));
const only = flag("where", "");
const messages = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json", "utf8"));
const textOf = new Map(Object.entries(messages).map(([text, v]) => [v.code, text]));
const NOISE = new Set([2304, 2307, 7006, 2564, 2503, 7008, 2552, 7005, 7010, 7031, 7019, 2792, 7034, 7053, 2339, 2322, 2345, 2554, 2558, 2314, 2315, 2749, 2693, 2362, 2363, 2365, 2367, 18046, 18048, 2532, 2531, 2454, 2448, 2695, 2349, 2351, 2344, 2694, 2724, 2709, 2502, 2635, 7022, 7023, 7024, 2391, 2355, 2378, 7011, 7051, 2683, 7041, 2488, 2461, 2741, 2739, 2740, 2353, 2561, 7015, 7017, 2538, 2536, 2537, 2769, 2540, 2542, 2551, 2571, 2590, 2589, 2456, 2313, 2310, 2440, 2395, 2449, 2450, 2453, 2715, 2717, 2403, 2374, 2300, 2451]);
const KEYWORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with as implements interface let package private protected public static yield abstract any asserts bigint boolean declare get infer is keyof module namespace never readonly require number object set string symbol type undefined unique unknown from global override of out accessor await async satisfies using defer constructor intrinsic".split(" "));
const norm = text => text.replace(/"([^"]*)"/g, (m, tok) => (/^[A-Za-z_$][\w$]*$/.test(tok) && !KEYWORDS.has(tok) ? "<name>" : /^#/.test(tok) ? "<#name>" : /^['"`]/.test(tok) || /^\d/.test(tok) ? "<literal>" : m)).replace(/^Unexpected ([A-Za-z_$][\w$]*)$/, (m, tok) => (KEYWORDS.has(tok) ? m : "Unexpected <name>")).replace(/^Unexpected #\w+$/, "Unexpected <#name>").replace(/ \(token: \w+\)$/, "");
const toUtf16 = (src, byte) => Buffer.from(src, "utf8").subarray(0, byte).toString("utf8").length;
const K = ts.SyntaxKind;
function whereOf(src, d, byte) {
  const sf = ts.createSourceFile(`/input.${d}`, src, ts.ScriptTarget.ESNext, true, d === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const pos = Math.min(toUtf16(src, Math.max(0, byte)), Math.max(0, sf.end - 1));
  let best = sf;
  const visit = node => { if (node.pos <= pos && pos < node.end) { best = node; ts.forEachChild(node, visit); } };
  ts.forEachChild(sf, visit);
  for (let n = best, child = null; n && n.kind !== K.SourceFile; child = n, n = n.parent) {
    if (n.kind === K.TypeAliasDeclaration) return child === n.type ? "alias-body" : "built";
    if (n.kind === K.InterfaceDeclaration) return child && child.kind === K.HeritageClause ? "interface-heritage" : child && n.members.includes(child) ? "interface-body" : "built";
    if (n.kind === K.IndexSignature && n.parent && (n.parent.kind === K.ClassDeclaration || n.parent.kind === K.ClassExpression)) return "class-index-signature";
    if (n.kind === K.HeritageClause && n.parent && (n.parent.kind === K.ClassDeclaration || n.parent.kind === K.ClassExpression)) return n.token === K.ImplementsKeyword ? "class-implements" : "class-extends";
    if (n.kind === K.TypeLiteral || n.kind === K.FunctionType || n.kind === K.ConstructorType || n.kind === K.MappedType) continue;
  }
  return "built";
}
const places = new Map();
let total = 0;
(async () => {
  for (const file of files) {
    const corpus = file.replace(/^.*j2\./, "").replace(/\.jsonl$/, "");
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
      if (!line.includes(`"cls":"${cls}"`)) continue;
      const r = JSON.parse(line);
      if (r.cls !== cls) continue;
      total++;
      const where = whereOf(r.src, r.d, cls === "A" ? r.lint.off : r.tsc[0][1] ?? 0);
      let row;
      if (cls === "A") {
        if (r.chk.length) row = `checker grammar TS${r.chk[0][0]} ${textOf.get(r.chk[0][0]) ?? r.chk[0][3]}`;
        else { const o = (r.oth || []).filter(c => !NOISE.has(c)); row = o.length ? `semantic TS${o[0]} ${textOf.get(o[0]) ?? ""}` : (r.oth || []).length ? "nothing but unknown names" : "nothing"; }
      } else row = `TS${r.tsc[0][0]} ${textOf.get(r.tsc[0][0]) ?? r.tsc[0][3]}`;
      let p = places.get(where);
      if (!p) places.set(where, (p = { ts: 0, tsx: 0, rows: new Map(), corpora: new Map() }));
      p[r.d]++;
      p.corpora.set(`${corpus} ${r.d}`, (p.corpora.get(`${corpus} ${r.d}`) ?? 0) + 1);
      let g = p.rows.get(row);
      if (!g) p.rows.set(row, (g = { ts: 0, tsx: 0, ex: [], srcs: new Set(), msgs: new Map(), plain: new Map() }));
      g[r.d]++;
      if (cls === "A") { const m = `${r.lint.code ? "TS" + r.lint.code : "no code"} ${norm(r.lint.bun)}`; g.msgs.set(m, (g.msgs.get(m) ?? 0) + 1); }
      const plain = (r.scan === null ? (r.full === null ? "accepts" : "parse pass accepts, visit rejects") : "rejects") + (cls === "A" && !r.lintPlain ? " [lint rejects only with the options of --lint]" : "");
      g.plain.set(plain, (g.plain.get(plain) ?? 0) + 1);
      if (!g.srcs.has(r.src)) { g.srcs.add(r.src); g.ex.push(r); g.ex.sort((a, b) => a.src.length - b.src.length); if (g.ex.length > nex) g.ex.pop(); }
    }
  }
  const all = m => [...m].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${key}: ${n}`);
  console.log(`class ${cls}: ${total} parses`);
  for (const [where, p] of [...places].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx)) console.log(`${String(p.ts).padStart(6)} ts ${String(p.tsx).padStart(6)} tsx  ${where.padEnd(22)} ${p.rows.size} rows | ${[...p.corpora].sort().map(([k, n]) => `${k}: ${n}`).join(", ")}`);
  for (const [where, p] of [...places].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx)) {
    if (only && only !== where) continue;
    console.log(`\n==== ${where}: ${p.ts} ts, ${p.tsx} tsx`);
    for (const [key, g] of [...p.rows].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx)) {
      console.log(`${String(g.ts).padStart(5)} ts ${String(g.tsx).padStart(5)} tsx ${String(g.srcs.size).padStart(5)} src  ${key}`);
      console.log(`        without lint: ${all(g.plain).join(", ")}${cls === "A" ? ` | lint: ${all(g.msgs).slice(0, 3).join(" | ")}${g.msgs.size > 3 ? ` | +${g.msgs.size - 3} more` : ""}` : ""}`);
      for (const e of g.ex) console.log(`        [${e.d}] ${JSON.stringify(e.src)} @${cls === "A" ? e.lint.off : e.tsc[0][1]}`);
    }
  }
})();
