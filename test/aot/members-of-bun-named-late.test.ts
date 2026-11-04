// A member of Bun that the program names counts as used, however late the compiler comes to the name. Here Bun has gone into hands that nobody follows, a store under a key that
// nobody knows may have hit the global of that name, and the name stands behind calls whose callees are found one after the other.
// That what counts as used is in the executable: parallel/closed-world/members-on-copies-of-host-objects.mjs and the programs beside it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const bunLeaves = `const functionNobodyKnows = Function("value", process.argv[2] ?? "return value");
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

// `open` hands its parameter to a function that nobody knows, and is first called with a value that nobody knows.
function openAfterUnknownValue(read: string) {
  return `const hide = Function("value", process.argv[4] ?? "return value");
const open = bun => {
  hide(bun);
  return new (${read})(${url});
};
try {
  open(hide({}));
} catch {}
`;
}

// Each way is written for SQL and names a member of its own in the program.
const ways: [string, string, string][] = [
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
  [
    "named on what Promise.all() resolves to",
    "",
    `async () => {\n    const [bun] = await Promise.all([Bun]);\n    return new bun.SQL(${url});\n  }`,
  ],
  ["named on what Promise.race() resolves to", "", `async () => new (await Promise.race([Bun])).SQL(${url})`],
  ["named on what Promise.any() resolves to", "", `async () => new (await Promise.any([Bun])).SQL(${url})`],
  [
    "named on what Promise.allSettled() resolves to",
    "",
    `async () => {\n    const [bun] = await Promise.allSettled([Bun]);\n    return new bun.value.SQL(${url});\n  }`,
  ],
  [
    "named on what Promise.withResolvers() is resolved with",
    "",
    `async () => {\n    const { promise, resolve } = Promise.withResolvers();\n    resolve(Bun);\n    return new (await promise).SQL(${url});\n  }`,
  ],
];

// Whoever walks over Bun has every member in hand, under names that the build cannot read. What native code makes is there anyway.
const walks: [string, string, string][] = [
  ["named on a spread copy", "", `() => new ({ ...Bun }).SQL(${url})`],
  ["named on a copy by Object.assign", "", `() => new (Object.assign({}, Bun).SQL)(${url})`],
  ["named on the descriptors of Bun", "", `() => new (Object.getOwnPropertyDescriptors(Bun).SQL.value)(${url})`],
  [
    "named on an object made of the entries of Bun",
    "",
    `() => new (Object.fromEntries(Object.entries(Bun)).SQL)(${url})`,
  ],
  [
    "named on an object made of the own keys of Bun and what Reflect.get reads",
    "",
    `() => new (Object.fromEntries(Reflect.ownKeys(Bun).map(key => [key, Reflect.get(Bun, key)])).SQL)(${url})`,
  ],
  [
    "named on a copy filled by for-in",
    "",
    `() => {\n    const copy = {};\n    for (const key in Bun) copy[key] = Bun[key];\n    return new copy.SQL(${url});\n  }`,
  ],
  [
    "named on the rest of a pattern",
    "",
    `() => {\n    const { ...rest } = Bun;\n    return new rest.SQL(${url});\n  }`,
  ],
];

const members = Reflect.ownKeys(Bun).filter(
  key => typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key),
) as string[];

async function membersUsed(files: Record<string, string>) {
  using dir = tempDir("aot-members-of-bun-named-late", files);
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

const calls = 14;

test.concurrent("a member counts as used whichever way it is named", async () => {
  const waysThatName = (nameOf: (index: number) => string) => ({
    "program.mjs": ways.map((_, index) => `import "./${index}.mjs";\n`).join(""),
    ...Object.fromEntries(
      ways.map(([, first, last], index) => [
        `${index}.mjs`,
        `${behindCalls(calls, first, last)}console.log(typeof (await holder${calls}.next()));\n`.replaceAll(
          "SQL",
          nameOf(index),
        ),
      ]),
    ),
  });
  const usedAnyway = await membersUsed(waysThatName(() => "noMemberOfBun"));
  // Two ways name it as a global. Four members let in code from outside.
  const named = members.filter(
    name =>
      !usedAnyway.includes(name) && !(name in globalThis) && !/^(ModuleGraph|Transpiler|build|plugin)$/.test(name),
  );
  expect(named.length).toBeGreaterThan(ways.length + 4);
  const used = await membersUsed(waysThatName(index => named[index]));
  expect(ways.filter((_, index) => !used.includes(named[index])).map(([way]) => way)).toEqual([]);
  // A module of Bun behind one member may name another. Most of what no way names is not used.
  const namedByNoWay = named.slice(ways.length);
  expect(namedByNoWay.filter(name => used.includes(name)).length).toBeLessThan(namedByNoWay.length / 4);
});

// A copy takes what is there. Nothing is made for it until somebody reads the copy under a name that the build cannot read.
const copies = ["named on a spread copy", "named on a copy by Object.assign", "named on the rest of a pattern"];

test.concurrent.each(walks)("%s: what code of Bun makes counts as used, but for a copy", async (walk, first, last) => {
  const program = `${first}console.log(typeof (await (${last})()));\n`.replaceAll("SQL", "noMemberOfBun");
  const used = await membersUsed({ "program.mjs": program });
  if (copies.includes(walk)) expect(used).not.toContain("$");
  else expect(used).toEqual(expect.arrayContaining(["$", "SQL", "postgres", "sql"]));
  expect(used).not.toContain("Archive");
});

// Keeping the text of functions brings no module of Bun into the executable, so the message does not advise it.
test.concurrent(
  "what is reached on a Bun that nobody names is left out, and the message says how to keep it",
  async () => {
    using dir = tempDir("aot-members-of-bun-named-late", {
      "program.mjs": `const SQL = globalThis[process.argv[3]][process.argv[2]];
try {
  new SQL(${url});
} catch (error) {
  console.log(error.message);
}
`,
    });
    const directory = String(dir);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "--no-compile-function-source", "program.mjs", "--outfile", "program"],
      directory,
    );
    expect(built.exitCode).toBe(0);
    const answer = await run([join(directory, isWindows ? "program.exe" : "program"), "SQL", "Bun"], directory);
    expect(answer.stdout).toStartWith(
      "Bun.SQL was not compiled into this executable because your code never uses it. To keep it, use it somewhere in your code. (",
    );
  },
);

// These let in code from outside, or a module of Bun makes them at the first read.
const unlikeTheOthers = ["ModuleGraph", "Transpiler", "build", "plugin", "SQL", "sql", "postgres", "$", "peek"];

test.concurrent.each([
  ["every member of Bun that is read by its name", members, (name: string) => `Bun.${name}`],
  [
    "a member that is unlike the others, read by Reflect.get or by Reflect.getOwnPropertyDescriptor",
    unlikeTheOthers,
    (name: string, index: number) => `Reflect.${index % 2 ? "getOwnPropertyDescriptor" : "get"}(Bun, "${name}")`,
  ],
] as const)("%s counts as used", async (_, names, read) => {
  const reads = `() => [\n${names.map((name, index) => `    ${read(name, index)},`).join("\n")}\n  ]`;
  const used = await membersUsed({
    "program.mjs": `${behindCalls(calls, "", reads)}console.log(holder${calls}.next().length);\n`,
  });
  expect(names.filter(name => !used.includes(name))).toEqual([]);
});
