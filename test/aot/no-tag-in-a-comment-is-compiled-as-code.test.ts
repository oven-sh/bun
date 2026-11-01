// A comment is no code. TypeScript's parser reads the tags of a `/** */` comment of a JavaScript file, and behind some of them it parses
// types, names and whole expressions. None of that runs, none of it asks for a file or a package, and a mistake in it stops no build.
// Every tag that the parser knows, with texts behind it that would be code if they were read as code, at every kind of place, in each kind
// of JavaScript file: the executable prints what `bun run` prints. A call that ran says which case it stands in.
import { expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { afterAll } from "./harness/declare";
import { compileCommand } from "./harness/flags";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test } from "./supported";

const tags = [
  "author",
  "implements",
  "augments",
  "extends",
  "class",
  "constructor",
  "public",
  "private",
  "protected",
  "readonly",
  "override",
  "deprecated",
  "this",
  "enum",
  "arg",
  "argument",
  "param",
  "return",
  "returns",
  "template",
  "type",
  "typedef",
  "callback",
  "overload",
  "satisfies",
  "see",
  "exception",
  "throws",
  "import",
  "property",
  "prop",
  "link",
  "nosuchtag",
];

const texts = [
  "",
  "{number} x",
  "{number} x a sentence, (with brackets) and @-signs: jane@example.com",
  "inside (@hit())",
  "@hit()",
  "hit()",
  "{hit()} x",
  "{number} [x=hit()]",
  "{number} [x=(@hit())]",
  "{number} [x=function () { hit(); }()]",
  "{number} [x=class { static y = hit(); }]",
  "{typeof hit()} x",
  "{(this: @hit() number) => void} x",
  "{{ [(@hit())]: number }} x",
  "{{ [<div>{hit()}</div>]: number }} x",
  '{import("./named-in-a-comment.js")} x',
  '{number} [x=import("./named-in-a-comment.js")]',
  '{number} [x=require("./named-in-a-comment.js")]',
  'x from "./named-in-a-comment.js"',
  '{ x } from "./named-in-a-comment.js"',
  '* as x from "./named-in-a-comment.js"',
  'x from "./named-in-a-comment.js" with { type: hit() }',
  'x from "no-such-package"',
  "x from (@hit())",
  "x from hit()",
  "x from <div>{hit()}</div>",
  "x from <></>",
  "{Promise<Array<string>>} x",
  "${hit()}",
  "Foo#bar",
  "Foo#event:bar",
  "lunr.Token~updateFunction",
  "{Object} lunr.Index~Result",
  "{Object} a.b.c",
  "<T extends hit()>",
  "[T=hit()]",
  "{`${hit()}`} x",
  "{() => hit()} x",
  "{{ a: hit() }} x",
  "{hit(",
  "{number} [x=hit(",
  "{number} x * / hit()",
];

function moduleOf(tag: string, first: number) {
  const cases = texts.map((text, index) => {
    const n = first + index;
    const behind = text.replaceAll("hit()", `hit(${n})`);
    const c = tag === "link" ? `/** see {@link ${behind}} */` : `/** @${tag} ${behind} */`;
    const lines =
      tag === "link" ? `/**\n * text\n * {@link ${behind}}\n */` : `/**\n * text\n * @${tag} ${behind}\n * more\n */`;
    return `${c}
${lines}
function declared${n}(${c} a, b) {
  ${c}
  const local = a;
  {
    ${c}
  }
  ${c}
  return ${c} (local) + b;
}
${c}
class Declared${n} {
  ${c}
  field = 1;
  ${c}
  method(${c} a) {
    return a;
  }
  ${c}
  static fixed = 2;
  ${c}
  constructor() {}
}
${c}
const constant${n} = 1;
${c}
let changed${n} = ${c} (2);
${c}
changed${n} += 1;
const object${n} = {
  ${c}
  key: 1,
  ${c}
  method() {
    return 1;
  },
};
${c}
const arrow${n} = ${c} a => a;
${c}
if (constant${n}) changed${n} += declared${n}(1, ${c} 2);
${c}
for (const each of [1]) changed${n} += each;
${c}
globalThis.total += changed${n} + new Declared${n}().method(3) + Declared${n}.fixed + object${n}.key + object${n}.method() + arrow${n}(4);
${c}
`;
  });
  return cases.join("");
}

function sourcesOf(kind: string) {
  const load = (name: string) => (kind === "cjs" ? `require("./${name}.${kind}");` : `import "./${name}.${kind}";`);
  const sources: Record<string, string> = {
    "package.json": `{ "name": "comments" }`,
    "named-in-a-comment.js": `console.log("a file named in a comment ran");\n`,
    [`first.${kind}`]: `globalThis.total = 0;
globalThis.hit = n => {
  console.log("code in a comment ran: case", n);
  return () => {};
};
`,
    [`main.${kind}`]: `${["first", ...tags].map(load).join("\n")}\nconsole.log("done", globalThis.total);\n`,
  };
  tags.forEach((tag, index) => (sources[`${tag}.${kind}`] = moduleOf(tag, index * texts.length)));
  return sources;
}

describe("compile/aot/no tag in a comment is compiled as code", () => {
  test.each(["js", "mjs", "cjs", "jsx"])(
    "%s",
    async kind => {
      const folder = String(tempDir(`aot-tags-in-comments-${kind}`, sourcesOf(kind)));
      afterAll(() => rmSync(folder, { recursive: true, force: true }));
      const plain = await spawned([bunExe(), `./main.${kind}`], folder, bunEnv);
      expect(plain).toMatchObject({ stdout: `done ${tags.length * texts.length * 18}\n`, exitCode: 0 });
      const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
      built(
        await spawned(
          [bunExe(), ...compileCommand, ...withoutDebugInformation, `./main.${kind}`, "--outfile", executable],
          folder,
          bunEnv,
        ),
      );
      const compiled = await spawned([executable], folder, bunEnv);
      expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
        stdout: plain.stdout,
        stderr: plain.stderr,
        exitCode: 0,
      });
    },
    600_000,
  );

  test.each(["js", "mjs", "cjs", "jsx"])(
    "%s in a test run",
    async kind => {
      const total = tags.length * texts.length * 18;
      const folder = String(
        tempDir(`aot-tags-in-comments-test-run-${kind}`, {
          ...sourcesOf(kind),
          "all.test.js": `import { expect, test } from "bun:test";
test("nothing in a comment ran", async () => {
  await import("./main.${kind}");
  expect(globalThis.total).toBe(${total});
});
`,
        }),
      );
      afterAll(() => rmSync(folder, { recursive: true, force: true }));
      const ran = async (flags: string[]) => {
        const run = await spawned([bunExe(), "test", ...flags, "./all.test.js"], folder, bunEnv);
        const counts = run.stderr.split("\n").filter(line => /^ \d+ (pass|fail)$/.test(line));
        return { stdout: run.stdout.replace(/^bun test .*\n/, ""), counts, exitCode: run.exitCode };
      };
      const plain = await ran([]);
      expect(plain).toEqual({ stdout: `done ${total}\n`, counts: [" 1 pass", " 0 fail"], exitCode: 0 });
      expect(await ran(["--aot"])).toEqual(plain);
    },
    600_000,
  );

  // A file that the parser finds a mistake in is not compiled where its load may be caught: these two roads ask that on their own.
  const odd = {
    "package.json": `{ "name": "comments" }`,
    "hash.js": `/** @import Foo#bar */\nexport const one = 1;\n`,
    "dollar.cjs": `/** @import \${hit()} */\nmodule.exports = { two: 2 };\n`,
  };

  test("a test run loads a file with a mistake in a comment", async () => {
    const folder = String(
      tempDir("aot-tags-in-comments-test-run", {
        ...odd,
        "a.test.js": `import { expect, test } from "bun:test";
import { one } from "./hash.js";
test("both load", () => {
  expect([one, require("./dollar.cjs").two]).toEqual([1, 2]);
});
`,
      }),
    );
    afterAll(() => rmSync(folder, { recursive: true, force: true }));
    const run = await spawned([bunExe(), "test", "--aot", "./a.test.js"], folder, bunEnv);
    expect({ stderr: run.stderr, exitCode: run.exitCode }).toEqual({
      stderr: expect.stringContaining(" 1 pass\n 0 fail\n"),
      exitCode: 0,
    });
  });

  // parallel/code-in-comments/a-name-shared-with-an-import-tag-is-exported has the forms, as an executable.
  test("a test run imports a name that an import tag also binds", async () => {
    const folder = String(
      tempDir("aot-tags-in-comments-shared-name", {
        "package.json": `{ "name": "comments" }`,
        "lib.mjs": `/** @import { f } from "./nothing.js" */\nfunction f() {\n  return 1;\n}\nexport { f };\n`,
        "a.test.mjs": `import { expect, test } from "bun:test";
import * as all from "./lib.mjs";
import { f } from "./lib.mjs";
test("it is the function", () => {
  expect([Object.keys(all), all.f(), f()]).toEqual([["f"], 1, 1]);
});
`,
      }),
    );
    afterAll(() => rmSync(folder, { recursive: true, force: true }));
    const run = await spawned([bunExe(), "test", "--aot", "./a.test.mjs"], folder, bunEnv);
    expect({ stderr: run.stderr, exitCode: run.exitCode }).toEqual({
      stderr: expect.stringContaining(" 1 pass\n 0 fail\n"),
      exitCode: 0,
    });
  });

  test("an executable loads such a file by a computed path", async () => {
    const folder = String(
      tempDir("aot-tags-in-comments-computed", {
        ...odd,
        "main.mjs": `const name = process.argv.length > 99 ? "x" : "hash";
console.log((await import("./" + name + ".js")).one);
`,
      }),
    );
    afterAll(() => rmSync(folder, { recursive: true, force: true }));
    const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
    const command = [bunExe(), ...compileCommand, ...withoutDebugInformation, "./main.mjs", "--outfile", executable];
    built(await spawned(command, folder, bunEnv));
    const run = await spawned([executable], folder, bunEnv);
    expect({ stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode }).toEqual({
      stdout: "1\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
