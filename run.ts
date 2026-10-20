// usage: bun-debug /tmp/try/run.ts <file.css> [defaults|none|old|k=v,...] [minify]
import { cssInternals } from "bun:internal-for-testing";
const { prefixTest, minifyTest } = cssInternals;
const T: Record<string, any> = {
  defaults: { chrome: 80 << 16, edge: 80 << 16, firefox: 78 << 16, safari: 14 << 16, opera: 67 << 16 },
  old: { safari: 8 << 16, firefox: 30 << 16 },
  none: undefined,
};
const file = process.argv[2];
const tname = process.argv[3] ?? "defaults";
let targets = T[tname];
if (!(tname in T)) {
  targets = {};
  for (const kv of tname.split(",")) {
    const [k, v] = kv.split("=");
    const [maj, min = "0"] = v.split(".");
    targets[k] = (Number(maj) << 16) | (Number(min) << 8);
  }
}
const src = await Bun.file(file).text();
const out = process.argv[4] === "minify" ? minifyTest(src, "", targets) : prefixTest(src, "", targets);
console.log(out);
