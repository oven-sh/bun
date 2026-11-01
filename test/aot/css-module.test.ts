import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const sheets = {
  "s.module.css": `.title { color: red }
.b { composes: title; }
.c { composes: other from "./nested/t.module.css"; }
.d { composes: plain from global; }
.my-class { color: blue }
#anchor { color: green }
@keyframes spin { from { opacity: 0 } to { opacity: 1 } }
.e { animation: spin 1s; composes: b c; }
`,
  "nested/t.module.css": `.other { color: green; composes: deep; } .deep { color: black }\n`,
  "s.css": `.x { color: red }\n`,
};

const list = `const list = object => Object.keys(object).sort().map(key => key + "=" + String(object[key])).join("|");`;

test("an executable reads the names of a CSS module", async () => {
  using dir = tempDir("aot-css-module", {
    ...sheets,
    "program.js": `import styles, { title } from "./s.module.css";
import * as space from "./s.module.css";
import nested from "./nested/t.module.css";
import sheet from "./s.css";
${list}
console.log("default " + list(styles));
console.log("named " + title + " " + (title === styles.title));
console.log("namespace " + Object.keys(space).sort().join() + " " + space["my-class"] + " " + (space.default === styles));
console.log("nested " + list(nested));
console.log("sheet " + list(sheet) + " " + typeof sheet);
const imported = await import("./s.module.css");
console.log("import() " + imported.title + " " + (imported.default === styles) + " " + Object.keys(imported).sort().join());
const required = require("./s.module.css");
console.log("require() " + required.title + " " + Object.keys(required).sort().join());
console.log("computed " + ["title", "b", "nope"].map(name => styles[name]).join("|"));
`,
  });
  const directory = String(dir);
  const executable = join(directory, `program${isWindows ? ".exe" : ""}`);
  const plain = await run([bunExe(), "program.js"], directory, bunEnv);
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toContain("named title_");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", executable],
    directory,
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  expect((await run([executable], directory, bunEnv)).stdout).toBe(plain.stdout);
});

test("a test run reads the names of a CSS module", async () => {
  using dir = tempDir("aot-css-module", {
    ...sheets,
    "product.js": `import styles from "./s.module.css";
export function label() { return styles.title + " " + styles["my-class"]; }
`,
    "a.test.js": `import { test } from "bun:test";
import styles, { title } from "./s.module.css";
import { label } from "./product.js";
${list}
test("t", async () => {
  console.log("SAY default " + list(styles));
  console.log("SAY named " + title);
  console.log("SAY product " + label());
  const imported = await import("./s.module.css");
  console.log("SAY import() " + imported.title + " " + (imported.default === styles));
  console.log("SAY require() " + list(require("./nested/t.module.css")));
});
`,
  });
  const directory = String(dir);
  const said = (text: string) =>
    text
      .split("\n")
      .filter(line => line.startsWith("SAY "))
      .join("\n");
  const plain = await run([bunExe(), "test", "./a.test.js"], directory, bunEnv);
  expect(plain.exitCode).toBe(0);
  expect(said(plain.stdout)).toContain("SAY named title_");
  const compiled = await run([bunExe(), "test", "--aot", "./a.test.js"], directory, bunEnv);
  expect(compiled.exitCode).toBe(0);
  expect(said(compiled.stdout)).toBe(said(plain.stdout));
});
