import { readFileSync } from "node:fs";
const dir = "/workspace/ref/typescript-go/internal/bundled/libs/";
const names = ["lib.es5.d.ts", "lib.dom.d.ts", "lib.es2015.core.d.ts", "lib.es2015.collection.d.ts", "lib.es2015.iterable.d.ts", "lib.es2015.generator.d.ts", "lib.es2015.promise.d.ts", "lib.es2015.proxy.d.ts", "lib.es2015.reflect.d.ts", "lib.es2015.symbol.d.ts", "lib.es2015.symbol.wellknown.d.ts", "lib.webworker.importscripts.d.ts", "lib.scripthost.d.ts", "lib.decorators.d.ts", "lib.decorators.legacy.d.ts"];
const texts = names.map(n => readFileSync(dir + n, "utf8"));
const bytes = texts.reduce((s, t) => s + Buffer.byteLength(t), 0);
const t = new Bun.Transpiler({ loader: "ts" });
const times: number[] = [];
const rounds = Number(process.argv[2] ?? 5);
for (let r = 0; r < rounds; r++) {
  const s = performance.now();
  for (const x of texts) t.transformSync(x);
  times.push(performance.now() - s);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ files: names.length, bytes, rounds, bestMs: +times[0].toFixed(1), medianMs: +times[times.length >> 1].toFixed(1) }));
