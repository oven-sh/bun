// A member of Bun that the program names is in the executable, however late the compiler comes to the name. Here Bun has gone into hands that nobody follows, a store under a key that
// nobody knows may have hit the global of that name, and the name stands behind calls whose callees are found one after the other. Once only a function of Bun was found there:
// `new Bun.SQL()`, whose class a module of Bun makes at the first read, threw "Bun.SQL was not compiled into this executable because your code never uses it".
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

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

describe.concurrent("the class that a module of Bun makes", () => {
  test.each([
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
    ["named on globalThis.Bun", "", `() => new globalThis.Bun.SQL(${url})`],
    ["named by a string in brackets", "", `() => new Bun["SQL"](${url})`],
    ["read by Reflect.get", "", `() => new (Reflect.get(Bun, "SQL"))(${url})`],
    ["named on require()", "", `() => new (import.meta.require("bun").SQL)(${url})`],
  ])("%s", async (_, first, last) => {
    using dir = tempDir("aot-members-of-bun-named-late", {
      "program.mjs": `${behindCalls(6, first, last)}console.log(typeof (await holder6.next()));\n`,
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

test("every member of Bun that is read by its name counts as used, early or late", async () => {
  // TODO: Bun.ModuleGraph, which lets in code from outside the executable, is still missed where it is named late.
  const names = Reflect.ownKeys(Bun).filter(
    key => typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key) && key !== "ModuleGraph",
  ) as string[];
  const reads = `() => [\n${names.map(name => `    Bun.${name},`).join("\n")}\n  ]`;
  const [early, late] = await Promise.all(
    [0, 6].map(count => membersUsed(`${behindCalls(count, "", reads)}console.log(holder${count}.next().length);\n`)),
  );
  expect(names.filter(name => !early.includes(name))).toEqual([]);
  expect(names.filter(name => !late.includes(name))).toEqual([]);
});
