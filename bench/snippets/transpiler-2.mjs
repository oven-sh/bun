import { join } from "path";
import { bench, run } from "../runner.mjs";

const code = require("fs").readFileSync(
  process.argv[2] || join(import.meta.dir, "../node_modules/@babel/standalone/babel.min.js"),
);

const transpiler = new Bun.Transpiler({ minify: true });

bench("transformSync", () => {
  transpiler.transformSync(code);
});

await run();
