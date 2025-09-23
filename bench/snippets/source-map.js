import { SourceMap } from "node:module";
import { readFileSync } from "node:fs";
import { bench, run } from "../runner.mjs";
const json = JSON.parse(readFileSync(process.argv.at(-1), "utf-8"));

bench("new SourceMap(json)", () => {
  return new SourceMap(json);
});

const map = new SourceMap(json);

const toRotate = [];
for (let j = 0; j < 10000; j++) {
  if (map.findEntry(0, j).generatedColumn) {
    toRotate.push(j);
    if (toRotate.length > 5) break;
  }
}
let i = 0;
bench("findEntry (match)", () => {
  return map.findEntry(0, toRotate[i++ % 3]).generatedColumn;
});

bench("findEntry (no match)", () => {
  return map.findEntry(0, 9999).generatedColumn;
});

await run();
