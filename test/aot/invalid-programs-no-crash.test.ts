// `bun check --aot` and `bun build --compile --aot` look at a program for the ahead-of-time compiler before they say what is wrong with it. A program that is wrong gets its errors, or is built: the
// tool does not end by a signal.
import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { unsupported } from "./run-programs";

const programs: Record<string, string> = {
  "a constant without an initializer that a loop stores to": "const v;\nfor (v of []) { }\n",
  "an exported constant without an initializer behind a label":
    "export const box: string\nlabel:\nexport const title: string\n",
  "`using` without an initializer": "function f() { using x; }\nasync function g() { await using y; }\nf();\n",
  "a guard of `this` on a function that has none":
    "function invalid(c: any): this is number { return false; }\ndeclare var c: number | number[];\nif (invalid(c)) { c; } else { c; }\n",
  "named imports without a module": "import { a }\n",
  "a namespace import without a module": "import * as a\n",
  "a default import that ends at `from`": "import a from\n",
  "`import` in front of a function's body": "function f(d: number): number import { const a = d; return a }\nf(1);\n",
  "`class` at the end of the file": "console.log(1);\nclass ",
  "`class` as the name of a constant": "const class = 1;\nconsole.log(2);\n",
  "a class declaration without a name": "class {}\nclass extends Object {}\n",
  "`class` at the end of a function": "function f() { class }\nf();\n",
  "class declarations without a name in a block, a namespace and a function":
    "{ class {} }\nnamespace N { class {} }\nfunction f() { class {} }\nf();\n",
  "an abstract class without a name": "abstract class {}\n",
  "a private method asked of `super` in a class expression below a name that nothing declares":
    "var C = class extends B {\n  #x() {}\n  method() { super.#x(); }\n};\n",
  "a class with a field below a name that nothing declares, made and handed on in a try block":
    'function print(text) { console.log(text); }\nfunction str(v) {}\nconst Readable = require("node:stream");\n\nclass B extends Middle {\n  text = "ok";\n  m() {\n    return "B.m " + this.text;\n  }\n}\nfunction report(label, x) {\n  print(label + " $.m(): " + str(x.m()));\n  print(label + " $.text: " + str(x.text));\n  printlabel + " values: " + Object.values(x).map.join;\n}\ntry {\n  report();\n} catch (e) {}\ntry {\n  report("o", new B);\n} catch (e) {}\ntry {} catch (e) {}\n',
};

// In a TypeScript file the checker's errors stop these before the compiler looks at them.
const isJavaScript = new Set([
  "a class with a field below a name that nothing declares, made and handed on in a try block",
]);

for (const [name, text] of Object.entries(programs)) {
  for (const words of [
    ["check", "--aot"],
    ["build", "--compile", "--aot", "--outfile", "program"],
  ]) {
    test.skipIf(!!unsupported)(
      `${name}: bun ${words[0]}`,
      async () => {
        using folder = tempDir("aot-wrong-programs", {});
        const entryPoint = join(String(folder), isJavaScript.has(name) ? "main.js" : "main.ts");
        writeFileSync(entryPoint, text);
        await using spawned = Bun.spawn({
          cmd: [bunExe(), ...words, entryPoint],
          cwd: String(folder),
          env: bunEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([spawned.stdout.text(), spawned.stderr.text(), spawned.exited]);
        expect({ signal: spawned.signalCode, panics: (stdout + stderr).match(/\bpanic\w*\b.*/g) ?? [] }).toEqual({
          signal: null,
          panics: [],
        });
      },
      60_000,
    );
  }
}
