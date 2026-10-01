// <bun> bunmeta.mjs <json file of sources> : per source the t.ts.deco result, as JSON lines
import { readFileSync } from "node:fs";
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const t = new Bun.Transpiler({ loader: "ts", tsconfig: DECO });
for (const src of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  let v;
  try { v = ["o", t.transformSync(src)]; } catch (e) { v = ["e", (e.errors?.length ? e.errors : [e]).map(x => String(x.message))]; }
  console.log(JSON.stringify({ src, v }));
}
