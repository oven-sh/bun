#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { type CompiledFunction, hex, ImageMap, nameOf } from "./map.ts";
import { readSamples } from "./lr-samples.ts";

const { values: args, positionals } = parseArgs({
  options: { map: { type: "string" }, "code-at": { type: "string" }, top: { type: "string", default: "25" } },
  allowPositionals: true,
});
if (positionals.length !== 1 || !args.map) {
  console.error("usage: bun scripts/aot/lr-report.ts <samples> --map <map of the image> --code-at <address>");
  process.exit(1);
}
const map = new ImageMap(args.map, args["code-at"]);
const samples = readSamples(positionals[0], map);

const count = (value: number) => String(value).padStart(7);
const percent = (part: number, whole: number) => (whole ? (100 * part) / whole : 0).toFixed(1).padStart(5) + "%";
const sorted = <K>(counts: Map<K, number>) => [...counts].sort((a, b) => b[1] - a[1]).slice(0, +args.top);
const add = <K>(counts: Map<K, number>, key: K, by: number) => counts.set(key, (counts.get(key) ?? 0) + by);

const { total, outside, inRegExps, isInExternalStubs } = samples;
const own = [...samples.own.values()].reduce((a, b) => a + b, 0);
const inStubs = [...samples.inStubs.values()].reduce(
  (a, byStub) => a + [...byStub.values()].reduce((c, d) => c + d, 0),
  0,
);
console.log(`${total} samples`);
console.log(`${count(own)} ${percent(own, total)}  compiled functions`);
console.log(`${count(inStubs)} ${percent(inStubs, total)}  stubs that they called`);
console.log(`${count(isInExternalStubs)} ${percent(isInExternalStubs, total)}  stubs that something else called`);
console.log(`${count(inRegExps)} ${percent(inRegExps, total)}  regular expressions`);
console.log(`${count(outside)} ${percent(outside, total)}  outside of the image`);

const byFunction = new Map<CompiledFunction, { own: number; stubs: number }>();
const rowOf = (offset: number) => {
  const place = map.at(offset);
  if (place.in !== "function") return undefined;
  if (!byFunction.has(place.function)) byFunction.set(place.function, { own: 0, stubs: 0 });
  return byFunction.get(place.function)!;
};
const byStub = new Map<string, number>();
const bySite = new Map<string, number>();
for (const [offset, samplesThere] of samples.own) rowOf(offset)!.own += samplesThere;
for (const [returnsTo, stubs] of samples.inStubs) {
  for (const [stub, samplesThere] of stubs) {
    rowOf(returnsTo)!.stubs += samplesThere;
    add(byStub, stub, samplesThere);
    add(bySite, `${stub}  from ${map.describe(returnsTo)}`, samplesThere);
  }
}

console.log(`\nfunctions\n    own   stubs`);
for (const [compiled, row] of [...byFunction]
  .sort((a, b) => b[1].own + b[1].stubs - (a[1].own + a[1].stubs))
  .slice(0, +args.top))
  console.log(
    `${count(row.own)} ${count(row.stubs)}  ${nameOf(compiled)}, ${compiled.size} bytes at ${hex(compiled.offset)}`,
  );

console.log(`\nstubs`);
for (const [stub, samplesThere] of sorted(byStub))
  console.log(`${count(samplesThere)} ${percent(samplesThere, inStubs)}  ${stub}`);

console.log(`\nstubs, by the place that called them (where the call returns to)`);
for (const [site, samplesThere] of sorted(bySite))
  console.log(`${count(samplesThere)} ${percent(samplesThere, inStubs)}  ${site}`);
