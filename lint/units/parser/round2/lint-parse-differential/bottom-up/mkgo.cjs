// The sources of a corpus as input of the typescript-go parse oracle (ledger/bottom-up/tsgo-oracle): two lines per source, as input.ts and input.tsx.
//   node mkgo.cjs <corpus.json> <out.jsonl>
const fs = require("fs");
const [corpusPath, outPath] = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const out = fs.createWriteStream(outPath);
let i = 0;
const put = src => { out.write(JSON.stringify({ id: `${i}.ts`, name: "input.ts", src }) + "\n" + JSON.stringify({ id: `${i}.tsx`, name: "input.tsx", src }) + "\n"); i++; };
for (const f of corpus.forms) for (const template of Object.values(corpus.contexts)) put(template.replace("%T%", () => f.t));
for (const s of corpus.sources) put(s.src);
out.end(() => console.log(outPath, i, "sources"));
