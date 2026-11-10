// An executable holds `d.toml` only as the program writes it: `import("./d.toml", { with: { type: "text" } })`. A `require()` or an `import()` without a type, under a
// name made at the run, asks for another form of the file. The executable does not hold that form, and says what it says where it holds nothing of the file:
// `Cannot find module './d.toml'`. Where it holds the form that the name asks for, that form answers.
// A require() says so whichever way its name is resolved: plainly, through a Module._resolveFilename that the program has replaced, or from the folders listed under `paths`.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const asks = `import { createRequire } from "node:module";
const made = JSON.parse(JSON.stringify("./d.toml"));
const said = error => [error?.constructor?.name, error?.code, String(error?.message).split("\\n")[0]].join(" | ");
try { console.log("require", JSON.stringify(createRequire(import.meta.url)(made))); } catch (error) { console.log("require threw", said(error)); }
try { console.log("import", JSON.stringify(await import(made))); } catch (error) { console.log("import threw", said(error)); }
`;
const held = (type: string) =>
  `if (process.argv.length > 99) await import("./d.toml", { with: { type: ${JSON.stringify(type)} } });\n`;

async function printOf(main: string) {
  using sources = tempDir("aot-an-ask-without-a-type", { "main.mjs": main, "d.toml": "a = 1\n" });
  using elsewhere = tempDir("aot-an-ask-without-a-type-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const beside = await run([executable], String(sources), bunEnv);
  const away = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: away.stdout, exitCode: away.exitCode }).toEqual({ stdout: beside.stdout, exitCode: 0 });
  return away.stdout;
}

test("the text form alone is held", async () => {
  const [nothing, text] = await Promise.all([printOf(asks), printOf(held("text") + asks)]);
  expect(nothing).toBe(
    "require threw ResolveMessage | MODULE_NOT_FOUND | Cannot find module './d.toml'\n" +
      "import threw ResolveMessage | ERR_MODULE_NOT_FOUND | Cannot find module './d.toml' imported from /$bunfs/root/main.mjs\n",
  );
  expect(text).toBe(nothing);
});

const otherWays = `import Module, { createRequire } from "node:module";
const made = JSON.parse(JSON.stringify("./d.toml"));
const said = error => [error?.constructor?.name, error?.code, String(error?.message).split("\\n")[0]].join(" | ");
const load = createRequire(import.meta.url);
try { console.log("paths", JSON.stringify(load(made, { paths: [import.meta.dirname] }))); } catch (error) { console.log("paths threw", said(error)); }
const original = Module._resolveFilename;
Module._resolveFilename = function (...given) { return original.apply(this, given); };
try { console.log("replaced", JSON.stringify(load(made))); } catch (error) { console.log("replaced threw", said(error)); }
`;

test("a require() whose name is resolved another way says the same", async () => {
  const [nothing, text, toml] = await Promise.all([
    printOf(otherWays),
    printOf(held("text") + otherWays),
    printOf(held("toml") + otherWays),
  ]);
  expect(nothing).toBe(
    "paths threw ResolveMessage | MODULE_NOT_FOUND | Cannot find module './d.toml'\n" +
      "replaced threw ResolveMessage | MODULE_NOT_FOUND | Cannot find module './d.toml'\n",
  );
  expect(text).toBe(nothing);
  expect(toml).toBe(`paths {"a":1}\nreplaced {"a":1}\n`);
});

test("the form that the name asks for is held", async () => {
  expect(await printOf(held("toml") + asks)).toBe(`require {"a":1}\nimport {"a":1,"default":{"a":1}}\n`);
});
