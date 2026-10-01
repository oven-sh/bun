// usage: <bun> bun-plain.mjs [inputs module] > plain.<binary>.txt
// What a parse WITHOUT lint does with each source, as ts and as js: `scanImports` runs the parse pass alone, `transformSync` the visit pass too.
// A line of `transformSync` is printed only where it differs from the line of `scanImports`.
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const groups = require(process.argv[2] ? join(process.cwd(), process.argv[2]) : join(import.meta.dir, "inputs.cjs"));
const errorsOf = run => {
  try {
    run();
    return "ACCEPTS";
  } catch (e) {
    const list = e?.errors ?? [e];
    return list.map(x => `@${x.position?.offset ?? "?"}+${x.position?.length ?? "?"} ${x.message}`).join(" | ");
  }
};
for (const [group, sources] of groups) {
  console.log(`\n== ${group}`);
  for (const src of sources) {
    console.log(JSON.stringify(src));
    for (const loader of ["ts", "js"]) {
      const transpiler = new Bun.Transpiler({ loader });
      const scan = errorsOf(() => transpiler.scanImports(src));
      const transform = errorsOf(() => transpiler.transformSync(src));
      console.log(`  a.${loader}  ${scan}`);
      if (transform !== scan) console.log(`  a.${loader}  transformSync differs: ${transform}`);
    }
  }
}
console.log(`\n${Bun.version} ${Bun.revision}`);
