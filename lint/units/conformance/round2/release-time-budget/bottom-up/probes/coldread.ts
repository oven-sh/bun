// usage: bun coldread.ts <mode> <cases directory>: reads every case once. mode: sync | bunfile | fsp | bunfile-<n> (n at a time)
import { readdirSync, readFileSync, promises as fsp } from "node:fs";
import { sample, delta, fmt } from "./meter.ts";
const [mode, casesDir] = process.argv.slice(2);
const paths: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`);
    else if (/\.tsx?$/.test(e.name)) paths.push(`${dir}/${e.name}`);
  }
};
const s0 = sample();
walk(`${casesDir}/compiler`);
walk(`${casesDir}/conformance`);
const s1 = sample();
console.log(fmt(`walk (${paths.length} files)`, delta(s0, s1)));
let bytes = 0;
if (mode === "sync") {
  for (const p of paths) bytes += readFileSync(p).length;
} else if (mode === "bunfile") {
  for (const b of await Promise.all(paths.map(p => Bun.file(p).arrayBuffer()))) bytes += b.byteLength;
} else if (mode === "fsp") {
  for (const b of await Promise.all(paths.map(p => fsp.readFile(p)))) bytes += b.length;
} else if (mode.startsWith("bunfile-")) {
  const n = Number(mode.slice(8));
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < paths.length) bytes += (await Bun.file(paths[next++]).arrayBuffer()).byteLength;
  }));
}
console.log(fmt(`read ${mode} (${bytes} bytes)`, delta(s1, sample())));
