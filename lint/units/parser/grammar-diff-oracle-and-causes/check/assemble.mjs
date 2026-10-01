// Scratch: a run file from the part file of one worker (what harness.mjs does after its workers end).
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { APIS, expand } from "/tmp/gdo/gd/harness.mjs";
const [corpusPath, partPath, outPath, version, revision] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const inputs = expand(corpus);
const lines = readFileSync(partPath, "utf8").split("\n").filter(Boolean).map(l => [JSON.parse(l).i, l]).sort((a, b) => a[0] - b[0]);
if (lines.length !== inputs.length) console.error(`${lines.length} records for ${inputs.length} inputs`);
const header = { header: 1, version, revision, corpus: corpus.name, count: inputs.length, apis: APIS.map(a => a[0]) };
writeFileSync(outPath, gzipSync(JSON.stringify(header) + "\n" + lines.map(l => l[1]).join("\n") + "\n"));
console.log(outPath, lines.length, "records");
