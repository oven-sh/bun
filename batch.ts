// usage: bun-debug batch.ts  → prints outputs for each case in cases.json: [css, targetsName, kind]
import { cssInternals } from "bun:internal-for-testing";
const { prefixTest, minifyTest, _test } = cssInternals;
const T: Record<string, any> = {
  defaults: { chrome: 80 << 16, edge: 80 << 16, firefox: 78 << 16, safari: 14 << 16, opera: 67 << 16 },
  old: { safari: 8 << 16, firefox: 30 << 16 },
  none: undefined,
};
const cases: [string, string, string?][] = JSON.parse(await Bun.file(process.argv[2]).text());
for (const [css, t, kind] of cases) {
  let targets = T[t];
  if (!(t in T)) {
    targets = {};
    for (const kv of t.split(",")) {
      const [k, v] = kv.split("=");
      targets[k] = Number(v) << 16;
    }
  }
  let out: string;
  try {
    out = kind === "min" ? minifyTest(css, "", targets) : prefixTest(css, "", targets);
  } catch (e) {
    out = "ERROR " + e;
  }
  console.log(JSON.stringify([css, t, kind ?? "", out.replace(/\s+/g, " ").trim()]));
}
