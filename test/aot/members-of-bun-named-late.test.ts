// A member of Bun that the program names is in the executable, however late the compiler comes to the name. Here Bun has gone into hands that nobody follows, a store under a key that
// nobody knows may have hit the global of that name, and the name stands behind calls whose callees are found one after the other. Once only a function of Bun was found there:
// `new Bun.SQL()`, whose class a module of Bun makes at the first read, threw "Bun.SQL was not compiled into this executable because your code never uses it".
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, eachRow, gap, test } from "./supported";

const bunLeaves = `const functionNobodyKnows = globalThis[process.argv[2] ?? "Boolean"];
globalThis[process.argv[3] ?? "nothing"] = functionNobodyKnows(1);
functionNobodyKnows(Bun);
`;

function behindCalls(count: number, first: string, last: string) {
  let text = `${bunLeaves}${first}const holder0 = {\n  next: ${last},\n};\n`;
  for (let index = 1; index <= count; index++)
    text += `const holder${index} = { next: () => holder${index - 1}.next() };\n`;
  return text;
}

const url = `"postgres://127.0.0.1:1/x"`;
const notCompiled = "Bun.SQL was not compiled into this executable";

// `open` hands its parameter to a function that nobody knows, and is first called with a value that nobody knows.
function openAfterUnknownValue(read: string) {
  return `const hide = globalThis[process.argv[4] ?? "Object"];
const open = bun => {
  hide(bun);
  return new (${read})(${url});
};
try {
  open(hide({}));
} catch {}
`;
}

// Which names the compiler comes to late depends on the order of its work, so each way is tried behind few calls and behind many.
describe.concurrent.each([6, 14])("the class that a module of Bun makes, behind %d calls", count => {
  eachRow<[string, string, string]>([
    ["named on Bun", "", `() => new Bun.SQL(${url})`],
    ["taken out of Bun by a pattern", "", `() => {\n    const { SQL } = Bun;\n    return new SQL(${url});\n  }`],
    [
      "taken out of import()",
      "",
      `async () => {\n    const { SQL } = await import("bun");\n    return new SQL(${url});\n  }`,
    ],
    ["named on a constant", "", `() => {\n    const bun = Bun;\n    return new bun.SQL(${url});\n  }`],
    ["named on a constant of the module", "const bun = Bun;\n", `() => new bun.SQL(${url})`],
    ["named on a parameter", `const open = bun => new bun.SQL(${url});\n`, `() => open(Bun)`],
    ["named on a parameter that took an unknown value first", openAfterUnknownValue("bun.SQL"), `() => open(Bun)`],
    ["named on globalThis.Bun", "", `() => new globalThis.Bun.SQL(${url})`],
    ["named by a string in brackets", "", `() => new Bun["SQL"](${url})`],
    ["read by Reflect.get", "", `() => new (Reflect.get(Bun, "SQL"))(${url})`],
    ["read by Reflect.get with a receiver", "", `() => new (Reflect.get(Bun, "SQL", Bun))(${url})`],
    ["read by Reflect.get taken out of Reflect", "const { get } = Reflect;\n", `() => new (get(Bun, "SQL"))(${url})`],
    ["read by Reflect.get.call", "", `() => new (Reflect.get.call(undefined, Bun, "SQL"))(${url})`],
    [
      "read by Reflect.get under a key in a parameter",
      `const open = key => new (Reflect.get(Bun, key))(${url});\n`,
      `() => open("SQL")`,
    ],
    [
      "read by Reflect.get on a parameter that took an unknown value first",
      openAfterUnknownValue(`Reflect.get(bun, "SQL")`),
      `() => open(Bun)`,
    ],
    ["read by Reflect.get on globalThis.Bun", "", `() => new (Reflect.get(globalThis.Bun, "SQL"))(${url})`],
    [
      "named on a parameter that takes globalThis.Bun",
      `const open = bun => new bun.SQL(${url});\n`,
      `() => open(globalThis.Bun)`,
    ],
    [
      "read by Reflect.getOwnPropertyDescriptor",
      "",
      `() => new (Reflect.getOwnPropertyDescriptor(Bun, "SQL").value)(${url})`,
    ],
    [
      "read by Object.getOwnPropertyDescriptor",
      "",
      `() => new (Object.getOwnPropertyDescriptor(Bun, "SQL").value)(${url})`,
    ],
    ["named on require()", "", `() => new (import.meta.require("bun").SQL)(${url})`],
    ["named on a spread copy", "", `() => new ({ ...Bun }).SQL(${url})`],
    ["named on a copy by Object.assign", "", `() => new (Object.assign({}, Bun).SQL)(${url})`],
    ["named on an object below Bun", "", `() => new (Object.create(Bun).SQL)(${url})`],
    ["named on a literal below Bun", "", `() => new ({ __proto__: Bun }).SQL(${url})`],
    [
      "named on what an async function returns",
      "const find = async () => Bun;\n",
      `async () => new (await find()).SQL(${url})`,
    ],
    ["named on what a promise resolves to", "", `async () => new (await Promise.resolve(Bun)).SQL(${url})`],
    ["named on what a reaction takes", "", `() => Promise.resolve(Bun).then(bun => new bun.SQL(${url}))`],
    ["named on a proxy of Bun", "", `() => new (new Proxy(Bun, {}).SQL)(${url})`],
    gap(notCompiled, [
      "named on what Promise.all() resolves to",
      "",
      `async () => {\n    const [bun] = await Promise.all([Bun]);\n    return new bun.SQL(${url});\n  }`,
    ]),
  ])("%s", async (_, first, last) => {
    using dir = tempDir("aot-members-of-bun-named-late", {
      "program.mjs": `${behindCalls(count, first, last)}console.log(typeof (await holder${count}.next()));\n`,
    });
    const directory = String(dir);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "program.mjs", "--outfile", "program"],
      directory,
    );
    expect(built.exitCode).toBe(0);
    const answer = await run([join(directory, isWindows ? "program.exe" : "program")], directory);
    expect({ stdout: answer.stdout, exitCode: answer.exitCode }).toEqual({ stdout: "function\n", exitCode: 0 });
  });
});

// Keeping the text of functions brings no module of Bun into the executable, so the message does not advise it.
test.each([[[]], [["--no-compile-function-source"]]])(
  "what is reached under a key that nobody knows is left out, and the message says how to keep it: %j",
  async flags => {
    using dir = tempDir("aot-members-of-bun-named-late", {
      "program.mjs": `const SQL = Bun[process.argv[2]];
try {
  new SQL(${url});
} catch (error) {
  console.log(error.message);
}
`,
    });
    const directory = String(dir);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, "program.mjs", "--outfile", "program"],
      directory,
    );
    expect(built.exitCode).toBe(0);
    const answer = await run([join(directory, isWindows ? "program.exe" : "program"), "SQL"], directory);
    expect(answer.stdout).toStartWith(
      "Bun.SQL was not compiled into this executable because your code never uses it. To keep it, use it somewhere in your code. (",
    );
  },
);

async function membersUsed(text: string) {
  using dir = tempDir("aot-members-of-bun-named-late", { "program.mjs": text });
  const { stderr } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "program.mjs"],
    String(dir),
    {
      ...bunEnv,
      NO_COLOR: "1",
    },
  );
  const prefix = "aot: trim: uses Bun ";
  return stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
}

// TODO: the members that let in code from outside the executable are still missed where a built-in reads them late.
const letInOutsideCode = ["ModuleGraph", "Transpiler", "build", "plugin"];
test.concurrent.each([
  ["its name", (name: string) => `Bun.${name}`, []],
  ["Reflect.get", (name: string) => `Reflect.get(Bun, "${name}")`, letInOutsideCode],
  [
    "Reflect.getOwnPropertyDescriptor",
    (name: string) => `Reflect.getOwnPropertyDescriptor(Bun, "${name}")`,
    letInOutsideCode,
  ],
])("every member of Bun that is read by %s counts as used, early or late", async (_, read, missed) => {
  const names = Reflect.ownKeys(Bun).filter(
    key => typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key) && !missed.includes(key),
  ) as string[];
  const reads = `() => [\n${names.map(name => `    ${read(name)},`).join("\n")}\n  ]`;
  const [early, late, later] = await Promise.all(
    [0, 6, 14].map(count =>
      membersUsed(`${behindCalls(count, "", reads)}console.log(holder${count}.next().length);\n`),
    ),
  );
  expect(names.filter(name => !early.includes(name))).toEqual([]);
  expect(names.filter(name => !late.includes(name))).toEqual([]);
  expect(names.filter(name => !later.includes(name))).toEqual([]);
});
