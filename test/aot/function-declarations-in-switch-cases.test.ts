import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const files = {
  "called-from-an-inner-block.cjs": `"use strict";\nfunction f(code) {\n  switch (code) {\n    case 1:\n      function helper(n) { return n + 1; }\n      if (code) { return helper(1); }\n  }\n  return 0;\n}\nconsole.log(f(1), f(2));\n`,
  "called-in-its-own-case.mjs": `function f(code) {\n  switch (code) {\n    case 1:\n      function helper(n) { return n + 1; }\n      return helper(1);\n  }\n  return 0;\n}\nconsole.log(f(1), f(2));\n`,
  "called-before-it-is-declared.cjs": `"use strict";\nfunction f(code) {\n  switch (code) {\n    case 1:\n      if (code) { return helper(1); }\n      function helper(n) { return n + 1; }\n  }\n  return 0;\n}\nconsole.log(f(1), f(2));\n`,
  "declared-in-a-case-that-is-not-entered.mjs": `function f(code) {\n  switch (code) {\n    case 1:\n      return helper(code);\n    case 2:\n      function helper(n) { return n + 40; }\n      return helper(0) + 1;\n    default:\n      return typeof helper;\n  }\n}\nconsole.log(f(1), f(2), f(3));\n`,
  "calls-itself.cjs": `"use strict";\nfunction format(code, message) {\n  switch (code) {\n    case 1:\n      const first = message.length;\n      if (first > 9) return "long";\n      function items(indent, next) {\n        let result = "";\n        for (const item of next) { result += " ".repeat(indent) + item.text; result += items(indent + 1, item.next); }\n        return result;\n      }\n      const found = message.match(/a(.)/);\n      if (found) {\n        let main = "found " + found[1];\n        if (message.length) main += items(1, [{ text: "x", next: [{ text: "y", next: [] }] }]);\n        return main;\n      }\n      break;\n    case 2:\n      return "two";\n  }\n  return "none";\n}\nconsole.log(format(1, "ab"), "|", format(1, "zz"), "|", format(2, ""), "|", format(3, ""));\n`,
  "sees-the-variables-of-the-switch.mjs": `function f(code) {\n  switch (code) {\n    case 1:\n      let count = 10;\n      function bump() { return ++count; }\n      bump();\n      return [bump(), count];\n    case 2:\n      try { return bump(); } catch (error) { return error.name; }\n  }\n}\nconsole.log(JSON.stringify(f(1)), JSON.stringify(f(1)), f(2));\n`,
  "is-one-object-an-entry.mjs": `function f(code) {\n  switch (code) {\n    case 1:\n      function helper() { return helper; }\n      const first = helper;\n      return [first === helper, helper() === first, helper];\n  }\n}\nconst a = f(1), b = f(1);\nconsole.log(a[0], a[1], a[2] === b[2], a[2].name, a[2].length);\n`,
  "is-stored-to.mjs": `function f(code) {\n  switch (code) {\n    case 1:\n      function helper() { return 1; }\n      const before = helper();\n      helper = () => 2;\n      return [before, helper()];\n  }\n}\nconsole.log(JSON.stringify(f(1)), JSON.stringify(f(1)));\n`,
  "is-kept-by-a-closure.mjs": `function f(code) {\n  const kept = [];\n  for (let i = 0; i < 3; i++) {\n    switch (code) {\n      case 1:\n        const here = i * 10;\n        function helper() { return here; }\n        kept.push(() => helper() + 1, helper);\n    }\n  }\n  return kept.map(each => each());\n}\nconsole.log(JSON.stringify(f(1)), JSON.stringify(f(2)));\n`,
  "two-of-one-name.cjs": `function f(code) {\n  switch (code) {\n    case 1:\n      function helper() { return "first"; }\n      return helper();\n    case 2:\n      function helper() { return "second"; }\n      return helper();\n  }\n}\nconsole.log(f(1), f(2));\n`,
  "at-the-top-level-of-a-module.mjs": `const code = Number(process.argv.length > 99) + 1;\nswitch (code) {\n  case 1:\n    function helper(n) { return n + 1; }\n    if (code) console.log(helper(1));\n}\nconsole.log(typeof helper);\n`,
  "async-and-generator.mjs": `async function f(code) {\n  switch (code) {\n    case 1:\n      async function later(n) { await null; return n + 1; }\n      function* numbers() { yield 1; yield 2; }\n      { return [await later(1), ...numbers()]; }\n  }\n}\nconsole.log(JSON.stringify(await f(1)), await f(2));\n`,
  "the-constant-decides-the-case.mjs": `function f() {\n  switch (2) {\n    case 1:\n      function helper() { return "one"; }\n      return helper();\n    case 2:\n      { return helper() + "!"; }\n  }\n}\nconsole.log(f());\n`,
  "control-in-a-block.cjs": `"use strict";\nfunction f(flag) {\n  {\n    function helper(n) { return n + 1; }\n    if (flag) { return helper(1); }\n  }\n  return 0;\n}\nconsole.log(f(true), f(false));\n`,
  "control-a-function-expression-in-a-case.mjs": `function f(code) {\n  switch (code) {\n    case 1:\n      const helper = function (n) { return n + 1; };\n      if (code) { return helper(1); }\n  }\n  return 0;\n}\nconsole.log(f(1), f(2));\n`,
};

const byTheLanguage: Record<string, string> = {
  "declared-in-a-case-that-is-not-entered.mjs": "41 41 function\n",
  "two-of-one-name.cjs": "second second\n",
  "the-constant-decides-the-case.mjs": "one!\n",
};

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(Object.keys(files))(
  "%s answers under --aot as it should",
  async entry => {
    using dir = tempDir("aot-functions-in-switch-cases", files);
    const plain =
      entry in byTheLanguage
        ? { stdout: byTheLanguage[entry], stderr: "", exitCode: 0 }
        : await run(String(dir), [bunExe(), "run", `./${entry}`]);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(plain.stdout).not.toBe("");
    expect(await run(String(dir), [bunExe(), "run", "--debug-aot", `./${entry}`])).toEqual(plain);
    const built = await run(String(dir), [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `./${entry}`,
      "--outfile",
      `./${entry}.exe`,
    ]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run(String(dir), [`./${entry}.exe`])).toEqual(plain);
  },
  120_000,
);
