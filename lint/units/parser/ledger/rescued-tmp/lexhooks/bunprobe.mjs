import { readFileSync } from "fs";
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [loader, code] of inputs) {
  let out;
  try {
    const t = new Bun.Transpiler({ loader });
    t.transformSync(code);
    out = ["OK"];
  } catch (e) {
    const errs = e?.errors ?? [e];
    out = errs.map(x => `${x?.position ? x.position.offset + "+" + x.position.length : "?"} ${x?.message ?? String(x)}`);
  }
  console.log(JSON.stringify({ loader, code, bun: out }));
}
