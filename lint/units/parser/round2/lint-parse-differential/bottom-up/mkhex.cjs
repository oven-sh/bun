// usage: node mkhex.cjs <corpus.json> <out.hex>   one line per source and dialect: "<index>.<ts|tsx> <ts|tsx> <hex>"
const fs = require("fs");
const [corpusPath, outPath] = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const out = fs.createWriteStream(outPath);
let i = 0;
const put = src => {
  const hex = Buffer.from(src, "utf8").toString("hex");
  out.write(`${i}.ts ts ${hex}\n${i}.tsx tsx ${hex}\n`);
  i++;
};
for (const f of corpus.forms) for (const template of Object.values(corpus.contexts)) put(template.replace("%T%", () => f.t));
for (const s of corpus.sources) put(s.src);
out.end(() => console.log(outPath, i, "sources"));
