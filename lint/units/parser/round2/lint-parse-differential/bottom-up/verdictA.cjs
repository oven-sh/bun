// Class A of join2 files (tsc parses, the lint parse rejects) by what tsc as a whole reports for the source:
// the first grammar error of its checker, else its other semantic codes without those of names that nothing declares, else nothing.
//   node verdictA.cjs <join2.jsonl>... [--ex=2]
// A row: counts (parses as ts / as tsx, distinct sources), the verdict, what the parse pass without lint does, the messages of the lint parse, examples.
const fs = require("fs");
const readline = require("readline");
const args = process.argv.slice(2);
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const files = args.filter(a => !a.startsWith("--"));
const nex = Number(flag("ex", "2"));
const messages = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json", "utf8"));
const textOf = new Map(Object.entries(messages).map(([text, v]) => [v.code, text]));
// Codes that say a name, a module or a type is not known, or that a declaration lacks what the probe leaves out.
const NOISE = new Set([2304, 2307, 7006, 2564, 2503, 7008, 2552, 7005, 7010, 7031, 7019, 2792, 7034, 7053, 2339, 2322, 2345, 2554, 2558, 2314, 2315, 2749, 2693, 2362, 2363, 2365, 2367, 18046, 18048, 2532, 2531, 2454, 2448, 2695, 2349, 2351, 2344, 2694, 2724, 2709, 2502, 2635, 7022, 7023, 7024, 2391, 2355, 2378, 7011, 7051, 2683, 7041, 2488, 2461, 2741, 2739, 2740, 2353, 2561, 7015, 7017, 2538, 2536, 2537, 2769, 2322, 2540, 2542, 2551, 2571, 2590, 2589, 2456, 2313, 2310, 2440, 2395, 2449, 2450, 2453, 2715, 2717, 2403, 2374, 2300, 2451]);
const KEYWORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with as implements interface let package private protected public static yield abstract any asserts bigint boolean declare get infer is keyof module namespace never readonly require number object set string symbol type undefined unique unknown from global override of out accessor await async satisfies using defer constructor intrinsic".split(" "));
const norm = text => text.replace(/"([^"]*)"/g, (m, tok) => (/^[A-Za-z_$][\w$]*$/.test(tok) && !KEYWORDS.has(tok) ? "<name>" : /^#/.test(tok) ? "<#name>" : /^['"`]/.test(tok) || /^\d/.test(tok) ? "<literal>" : m)).replace(/^Unexpected ([A-Za-z_$][\w$]*)$/, (m, tok) => (KEYWORDS.has(tok) ? m : "Unexpected <name>")).replace(/^Unexpected #\w+$/, "Unexpected <#name>").replace(/ \(token: \w+\)$/, "");
const groups = new Map();
let total = 0;
(async () => {
  for (const file of files) {
    const corpus = file.replace(/^.*j2\./, "").replace(/\.jsonl$/, "");
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
      if (!line.includes('"cls":"A"')) continue;
      const r = JSON.parse(line);
      if (r.cls !== "A") continue;
      total++;
      let verdict;
      if (r.chk.length) verdict = `checker grammar TS${r.chk[0][0]} ${textOf.get(r.chk[0][0]) ?? r.chk[0][3]}`;
      else {
        const o = (r.oth || []).filter(c => !NOISE.has(c));
        verdict = o.length ? `semantic TS${o[0]} ${textOf.get(o[0]) ?? ""}` : (r.oth || []).length ? "nothing but unknown names" : "nothing";
      }
      let g = groups.get(verdict);
      if (!g) groups.set(verdict, (g = { ts: 0, tsx: 0, ex: [], srcs: new Set(), msgs: new Map(), plain: new Map(), corpora: new Map() }));
      g[r.d]++;
      const m = `${r.lint.code ? "TS" + r.lint.code : "no code"} ${norm(r.lint.bun)}`;
      g.msgs.set(m, (g.msgs.get(m) ?? 0) + 1);
      const plain = (r.scan === null ? (r.full === null ? "accepts" : "parse pass accepts, visit rejects") : "rejects") + (r.lintPlain ? "" : " [lint parse rejects only with the options of --lint]");
      g.plain.set(plain, (g.plain.get(plain) ?? 0) + 1);
      g.corpora.set(corpus, (g.corpora.get(corpus) ?? 0) + 1);
      if (!g.srcs.has(r.src)) {
        g.srcs.add(r.src);
        g.ex.push(r);
        g.ex.sort((a, b) => a.src.length - b.src.length);
        if (g.ex.length > nex) g.ex.pop();
      }
    }
  }
  const all = m => [...m].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${key}: ${n}`);
  console.log(`${total} parses in ${groups.size} groups`);
  for (const [key, g] of [...groups].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx)) {
    console.log(`${String(g.ts).padStart(5)} ts ${String(g.tsx).padStart(5)} tsx ${String(g.srcs.size).padStart(5)} src  ${key}`);
    console.log(`        corpora: ${all(g.corpora).join(", ")} | without lint: ${all(g.plain).join(", ")}`);
    console.log(`        lint: ${all(g.msgs).slice(0, 4).join(" | ")}${g.msgs.size > 4 ? ` | +${g.msgs.size - 4} more` : ""}`);
    for (const e of g.ex) console.log(`        [${e.d}] ${JSON.stringify(e.src)} @${e.lint.off}`);
  }
})();
