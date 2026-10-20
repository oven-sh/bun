// Random blocks of text-decoration / text-emphasis / list-style-image declarations.
// Checks: no crash, a re-parse pass is stable, a merged-rule pass is stable.
import { cssInternals } from "bun:internal-for-testing";
const { prefixTest } = cssInternals;
const targetsList: Record<string, any> = {
  defaults: { chrome: 80 << 16, edge: 80 << 16, firefox: 78 << 16, safari: 14 << 16, opera: 67 << 16 },
  old: { safari: 8 << 16, firefox: 30 << 16, chrome: 25 << 16 },
  chrome90: { chrome: 90 << 16 },
  none: undefined,
};
let seed = Number(process.argv[2] ?? 1) >>> 0;
// mulberry32
const rand = (n: number) => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) % n);
};
const pick = <T,>(a: T[]) => a[rand(a.length)];
const lines = ["none", "underline", "overline", "line-through", "underline overline", "blink"];
const styles = ["solid", "dotted", "wavy", "double"];
const colors = ["red", "blue", "currentColor", "lch(50.998% 135.363 338)", "#123"];
const thick = ["auto", "from-font", "2px", "10%"];
const estyles = ["none", "dot", "open circle", "filled", '"x"', "sesame"];
const pre = () => pick(["", "", "", "-webkit-", "-moz-"]);
const decl = (): string => {
  switch (rand(17)) {
    case 0: return `${pre()}text-decoration: ${pick(lines)}`;
    case 1: return `${pre()}text-decoration: ${pick(lines)} ${pick(styles)}`;
    case 2: return `${pre()}text-decoration: ${pick(lines)} ${pick(styles)} ${pick(colors)}`;
    case 3: return `${pre()}text-decoration: ${pick(lines)} ${pick(thick)} ${pick(colors)}`;
    case 4: return `${pre()}text-decoration-line: ${pick(lines)}`;
    case 5: return `${pre()}text-decoration-style: ${pick(styles)}`;
    case 6: return `${pre()}text-decoration-color: ${pick(colors)}`;
    case 7: return `text-decoration-thickness: ${pick(thick)}`;
    case 8: return `${pick(["", "", "-webkit-"])}text-emphasis: ${pick(estyles)} ${pick(colors)}`;
    case 9: return `${pick(["", "", "-webkit-"])}text-emphasis-style: ${pick(estyles)}`;
    case 10: return `${pick(["", "", "-webkit-"])}text-emphasis-color: ${pick(colors)}`;
    case 11: return `${pick(["", "", "-webkit-"])}text-emphasis-position: ${pick(["over", "under", "over left", "under right"])}`;
    case 12: return `${pre()}${pick(["text-decoration", "text-decoration-color", "text-emphasis", "text-emphasis-position", "text-decoration-thickness"])}: ${pick(["var(--v)", "inherit", "initial"])}`;
    case 13: return pick(["all: unset", "cursor: pointer", "--x: 1", "color: red", "color: blue", "margin: 0", "-khtml-text-decoration: none", "display: block", "top: 0", "transform: none", "width: 1px", "background: red"]);
    case 16: return pick(["display: block", "top: 0", "color: red", "color: blue", "--x: 1"]);
    case 14: return `list-style-image: ${pick(["none", "url(a.png)", 'image-set("a.png" 1x, "b.png" 2x)', '-webkit-image-set(url(a.png) 1x)', "linear-gradient(red, blue)", "var(--i)", "linear-gradient(lch(50% 100 40), blue)"])}`;
    default: return pick(["list-style: square", "text-decoration: underline", "text-decoration: none"]);
  }
};
const N = Number(process.argv[3] ?? 3000);
let bad = 0;
for (const [tname, targets] of Object.entries(targetsList)) {
  const blocks: string[] = [];
  for (let i = 0; i < N; i++) {
    const n = 1 + rand(6);
    const ds: string[] = [];
    for (let k = 0; k < n; k++) ds.push(decl() + (rand(8) === 0 ? " !important" : ""));
    blocks.push(ds.join("; "));
  }
  const sheet = blocks.map((b, i) => `.r${i} { ${b} }`).join("\n");
  const out = prefixTest(sheet, "", targets);
  const again = prefixTest(out, "", targets);
  const merged = prefixTest(blocks.map((b, i) => `.r${i} { ${b} }\n.r${i} { --z: 1 }`).join("\n"), "", targets).replaceAll("  --z: 1;\n", "");
  const split = (s: string) => s.split("\n}\n");
  const [a, b, c] = [split(out), split(again), split(merged)];
  let local = 0;
  // Rule 1 smoke check: a prefix that the author wrote for a group is still in the rule.
  const first = new Map<string, string>();
  for (const rule of a) {
    const header = rule.split("\n").find(line => line.endsWith("{")) ?? "";
    for (const m of header.matchAll(/\.r(\d+)/g)) first.set(m[1], rule);
  }
  let lost = 0;
  for (let i = 0; i < blocks.length; i++) {
    const rule = first.get(String(i)) ?? "";
    for (const p of ["-webkit-text-decoration", "-moz-text-decoration", "-webkit-text-emphasis"]) {
      if (blocks[i].includes(p) && !rule.includes(p)) {
        if (lost++ < 3) console.log(`--- ${tname} lost ${p}:\nSOURCE: ${blocks[i]}\nOUT:${rule}\n`);
      }
    }
  }
  bad += lost;
  if (a.length !== b.length || a.length !== c.length) { console.log(tname, "RULE COUNT DIFFERS", a.length, b.length, c.length); bad++; continue; }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] || a[i] !== c[i]) {
      const idx = Number(/\.r(\d+) \{/.exec(a[i])?.[1] ?? -1);
      const calc = a[i].includes('calc(1em') && a[i] === c[i];
      if (calc) continue;
      if (local++ < Number(process.argv[4] ?? 3)) console.log(`--- ${tname} unstable:\nSOURCE: ${blocks[idx]}\nFIRST:${a[i]}\nREPARSE:${b[i]}\nMERGED:${c[i]}\n`);
    }
  }
  bad += local;
  console.log(tname, "blocks", N, "unstable", local);
}
process.exit(bad ? 1 : 0);
