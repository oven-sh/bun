// "a named export that no `import` of yours reads throws when it is read, and the `default` export is whole" (docs/compiler/compatibility.mdx, "Code from strings").
// `bun <file>` reads the name and an executable without --aot does not find the file, so neither says what an executable says: the answers are written here.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const attempt = `const attempt = f => {
  try {
    return String(f());
  } catch (error) {
    return "threw " + error.code;
  }
};
`;
const byEval = `const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
`;

const programs: Record<string, [text: string, underBun: string, compiled: string]> = {
  "a read": [
    `import { a } from "./rows.json";\n${attempt}${byEval}console.log(a, attempt(() => got.b), got.default.b, Object.keys(got.default).join());\n`,
    "1 2 2 a,b,c",
    "1 threw ERR_MODULE_NOT_FOUND 2 a,b,c",
  ],
  "a read under a made key, and by Reflect.get": [
    `import { a } from "./rows.json";\n${attempt}${byEval}console.log(a, attempt(() => got["b".trim()]), attempt(() => Reflect.get(got, "c")));\n`,
    "1 2 3",
    "1 threw ERR_MODULE_NOT_FOUND threw ERR_MODULE_NOT_FOUND",
  ],
  "whatever reads every value: a spread, Object.entries, a descriptor": [
    `import { a } from "./rows.json";\n${attempt}${byEval}console.log(a, attempt(() => Object.keys({ ...got }).length), attempt(() => Object.entries(got).length), attempt(() => Object.getOwnPropertyDescriptor(got, "b").value));\n`,
    "1 4 4 2",
    "1 threw ERR_MODULE_NOT_FOUND threw ERR_MODULE_NOT_FOUND threw ERR_MODULE_NOT_FOUND",
  ],
  "a pattern takes what is there and stops at what is not": [
    `import { a } from "./rows.json";\n${attempt}${byEval}console.log(attempt(() => (({ a: kept, default: whole }) => kept + " " + whole.b)(got)), attempt(() => (({ b }) => b)(got)), a);\n`,
    "1 2 2 1",
    "1 2 threw ERR_MODULE_NOT_FOUND 1",
  ],
  "the evaluator is the constructor of a parameter, called with new: it is spelled nowhere": [
    `import rows from "./rows.json";\n${attempt}function make(f) {\n  return new f.constructor("p", "return import(p)");\n}\nconst got = await make(make)(import.meta.dirname + "/rows.json");\nconsole.log(Object.keys(rows).length, attempt(() => got.b), got.default.b, Object.keys(got).sort().join());\n`,
    "3 2 2 a,b,c,default",
    "3 threw ERR_MODULE_NOT_FOUND 2 a,b,c,default",
  ],
  "the evaluator is a constructor that a function gives back": [
    `import rows from "./rows.json";\n${attempt}function take(f) {\n  return f.constructor;\n}\nconst got = await take(take)("p", "return import(p)")(import.meta.dirname + "/rows.json");\nconsole.log(Object.keys(rows).length, attempt(() => got.b), got.default.b, Object.keys(got).sort().join());\n`,
    "3 2 2 a,b,c,default",
    "3 threw ERR_MODULE_NOT_FOUND 2 a,b,c,default",
  ],
  "members are stored, added and deleted before the text asks: the names are those of the file": [
    `import rows, { a } from "./rows.json";\n${attempt}rows.b = 9;\nrows.z = 1;\ndelete rows.c;\n${byEval}console.log(a, attempt(() => got.b), attempt(() => got.z), attempt(() => got.c), Object.keys(got).sort().join());\n`,
    "1 2 undefined 3 a,b,c,default",
    "1 threw ERR_MODULE_NOT_FOUND undefined threw ERR_MODULE_NOT_FOUND a,b,c,default",
  ],
  "the error names the export, the file and the way out": [
    `import { a } from "./rows.json";\n${byEval}try {\n  got.b;\n} catch (error) {\n  console.log(a, ["Cannot read 'b' from the namespace object of '", "rows.json'", "Import 'b' by name."].every(part => error.message.includes(part)));\n}\n`,
    "",
    "1 true",
  ],
  "whether it is frozen or sealed, and sealing it, read the values": [
    `import { b } from "./rows.json";\n${attempt}${byEval}console.log(b, attempt(() => Object.isFrozen(got)), attempt(() => Object.isSealed(got)), attempt(() => Object.seal(got) === got), got.default.a);\n`,
    "2 false true true 1",
    "2 threw ERR_MODULE_NOT_FOUND threw ERR_MODULE_NOT_FOUND threw ERR_MODULE_NOT_FOUND 1",
  ],
  "whether it is frozen is settled by the first name, which is read": [
    `import { a } from "./rows.json";\n${attempt}${byEval}console.log(a, attempt(() => Object.isFrozen(got)));\n`,
    "1 false",
    "1 false",
  ],
  "a copy by descriptors": [
    `import { a } from "./rows.json";\n${attempt}${byEval}const copy = {};\nconst made = attempt(() => {\n  for (const key of Object.getOwnPropertyNames(got)) {\n    const found = Object.getOwnPropertyDescriptor(got, key);\n    Object.defineProperty(copy, key, { get: () => got[key], enumerable: found.enumerable });\n  }\n  return Object.keys(copy).join();\n});\nconsole.log(a, made, got.default.b);\n`,
    "1 a,b,c,default 2",
    "1 threw ERR_MODULE_NOT_FOUND 2",
  ],
  "typeof is a read": [
    `import { a } from "./rows.json";\n${attempt}${byEval}console.log(a, attempt(() => typeof got.b), typeof got.default.b);\n`,
    "1 number number",
    "1 threw ERR_MODULE_NOT_FOUND number",
  ],
  "a text that a text imports by a data: URL is refused where a name is left out": [
    `import { a } from "./rows.json";\nconst load = (0, eval)("p => import(p)");\nconst text = "import rows from " + JSON.stringify(import.meta.dirname + "/rows.json") + "; export default typeof rows.a;";\nconst said = await load("data:text/javascript," + encodeURIComponent(text)).then(\n  it => it.default,\n  error => "threw " + error.code,\n);\nconsole.log(a, said);\n`,
    "1 number",
    "1 threw ERR_MODULE_NOT_FOUND",
  ],
  "and where none is, as an executable without --aot refuses it": [
    `import { a, b, c } from "./rows.json";\nconst load = (0, eval)("p => import(p)");\nconst text = "import rows from " + JSON.stringify(import.meta.dirname + "/rows.json") + "; export default typeof rows.a;";\nconst said = await load("data:text/javascript," + encodeURIComponent(text)).then(\n  it => it.default,\n  error => "threw " + error.code,\n);\nconsole.log(a, b, c.length, said);\n`,
    "1 2 1 number",
    "1 2 1 threw ERR_MODULE_NOT_FOUND",
  ],
  "it is the ReferenceError of an export that cannot be read, with a code": [
    `import { a } from "./rows.json";\n${byEval}try {\n  console.log(a, got.b);\n} catch (error) {\n  console.log(a, error.name, error instanceof ReferenceError, error.code);\n}\n`,
    "1 2",
    "1 ReferenceError true ERR_MODULE_NOT_FOUND",
  ],
  "the printers do not throw: util.inspect says <uninitialized>, console.log says undefined": [
    `import { inspect } from "node:util";\nimport { a } from "./rows.json";\n${byEval}const onOneLine = text => text.replace(/\\s+/g, " ");\nconsole.log(a, onOneLine(inspect(got)));\nconsole.log(a, onOneLine(Bun.inspect(got)));\n`,
    "1 Module <[Object: null prototype] {}> [Module] { a: 1, b: 2, c: [ 3 ], default: { a: 1, b: 2, c: [ 3 ] } }\n1 Module { a: 1, b: 2, c: [ 3 ], default: { a: 1, b: 2, c: [ 3 ], }, }",
    "1 Module <[Object: null prototype] {}> [Module] { a: 1, b: <uninitialized>, c: <uninitialized>, default: { a: 1, b: 2, c: [ 3 ] } }\n1 Module { a: 1, b: undefined, c: undefined, default: { a: 1, b: 2, c: [ 3 ], }, }",
  ],
  "the way out that the error names": [
    `import { a, b } from "./rows.json";\n${attempt}${byEval}console.log(a, b, attempt(() => got.b), attempt(() => got.c));\n`,
    "1 2 2 3",
    "1 2 2 threw ERR_MODULE_NOT_FOUND",
  ],
};

describe("a name that was left out of a file of data", () => {
  test.each(Object.entries(programs))(
    "%s",
    async (_, [text, underBun, printed]) => {
      using dir = tempDir("aot-a-name-left-out-of-data", {
        "main.mjs": text,
        "rows.json": `{ "a": 1, "b": 2, "c": [3] }`,
      });
      const directory = String(dir);
      const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
      const executable = join(directory, isWindows ? "program.exe" : "program");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
        directory,
      );
      expect(built.exitCode).toBe(0);
      const compiled = await run([executable], directory, bunEnv);
      expect([plain.stdout.trim(), plain.exitCode]).toEqual([underBun, 0]);
      expect([compiled.stdout.trim(), compiled.exitCode]).toEqual([printed, 0]);
    },
    240_000,
  );
});
