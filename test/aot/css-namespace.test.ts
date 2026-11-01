import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("the namespace of a CSS file has what bun run gives it", async () => {
  using dir = tempDir("aot-css-namespace", {
    "package.json": `{ "name": "p", "type": "module" }`,
    ...Object.fromEntries(["a", "b", "c", "d", "e"].map(name => [`${name}.css`, `.${name} { color: red; }\n`])),
    "body.mjs": `
      import * as statement from "./a.css";
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const shown = m => Reflect.ownKeys(m).filter(key => typeof key === "string").sort().map(key => key + "=" + JSON.stringify(m[key])).join();
      const name = text => process.env.NOBODY_SETS_THIS || text;
      export async function say() {
        console.log("statement:", shown(statement));
        console.log("written:", shown(await import("./b.css")));
        console.log("out of sight:", shown(await import(name("./c.css"))));
        console.log("of a list:", shown(await import("./" + ["d.css"][process.argv.length > 99 ? 1 : 0])));
        console.log("required:", shown(require("./e.css")));
      }`,
    "entry.mjs": `import { say } from "./body.mjs"; await say();`,
    "a.test.mjs": `import { test } from "bun:test"; import { say } from "./body.mjs"; test("t", say);`,
  });
  const project = String(dir);
  const said = (stdout: string) => stdout.split("\n").filter(line => /^[a-z ]+: /.test(line) || line.endsWith(":"));
  const plain = said((await run([bunExe(), "entry.mjs"], project, bunEnv)).stdout);
  expect(plain.slice(0, 4).map(line => line.split(": ")[1])).toEqual(Array(4).fill(`__esModule=true,default={}`));
  expect(said((await run([bunExe(), "test", "./a.test.mjs"], project, bunEnv)).stdout)).toEqual(plain);
  expect(said((await run([bunExe(), "test", "--aot", "./a.test.mjs"], project, bunEnv)).stdout)).toEqual(plain);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./entry.mjs", "--outfile", join(project, "x")],
    project,
  );
  expect(built.exitCode).toBe(0);
  expect(said((await run([join(project, "x")], project, bunEnv)).stdout)).toEqual(plain);
}, 180_000);
