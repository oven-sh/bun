// A member of Bun that the program names counts as used, whichever way the program comes by Bun and however late the compiler comes to the name: it stands behind calls whose callees
// are found one after the other. Each way is a program of its own: beside another, a way that lets Bun go would hide what the others do.
// A way that the compiler follows keeps Bun in sight, and what the program does not name is not used. A way that it does not follow lets Bun go: every member may be used, and
// with the members that load code the report is open.
// That what counts as used is in the executable: parallel/closed-world/members-on-copies-of-host-objects.mjs and the programs beside it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

function behindCalls(count: number, first: string, last: string) {
  let text = `${first}const holder0 = {\n  next: ${last},\n};\n`;
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

// Each way is written for SQL.
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

// Whoever walks over Bun has every member in hand, under names that the build cannot read.
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

// The others let Bun go today. A way that the compiler learns to follow comes onto this list.
const followed = [
  "named on Bun",
  "taken out of Bun by a pattern",
  "named on a constant",
  "named on globalThis.Bun",
  "named by a string in brackets",
  "named on require()",
];

const members = Reflect.ownKeys(Bun).filter(
  key => typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key),
) as string[];

const everyMember = "(escapes, so any member may be used)";

async function membersUsed(program: string) {
  using dir = tempDir("aot-members-of-bun-named-late", { "program.mjs": program });
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
const named = (first: string, last: string, name: string) =>
  `${behindCalls(calls, first, last)}console.log(typeof (await holder${calls}.next()));\n`.replaceAll("SQL", name);

test.concurrent.each(ways)("%s: the member counts as used", async (way, first, last) => {
  const used = await membersUsed(named(first, last, "Archive"));
  expect(used).toContain("Archive");
  expect({ way, letsBunGo: used.includes(everyMember) }).toEqual({ way, letsBunGo: !followed.includes(way) });
  // A module of Bun behind one member may name another. Most of what the program does not name is not used.
  if (followed.includes(way)) expect(used.length).toBeLessThan(members.length / 4);
});

test.concurrent.each(walks)("%s: every member may be used", async (_, first, last) => {
  const used = await membersUsed(named(first, last, "noMemberOfBun"));
  expect(used).toContain(everyMember);
  expect(members.filter(name => !used.includes(name))).toEqual([]);
});

// A written text is unseen code, and what it is handed is in hands that nobody follows.
test.concurrent("a Bun that is handed to a function made of a text: every member may be used", async () => {
  const used = await membersUsed(`const functionNobodyKnows = Function("value", process.argv[2] ?? "return value");
functionNobodyKnows(Bun);
`);
  expect(used).toContain(everyMember);
  expect(members.filter(name => !used.includes(name))).toEqual([]);
});

// A key on the global object that nobody knows may be any name, `Bun` among them, and so may the key on what is found there.
test.concurrent("what is reached on a Bun that nobody names is in the executable", async () => {
  using dir = tempDir("aot-members-of-bun-named-late", {
    "program.mjs": `const SQL = globalThis[process.argv[3]][process.argv[2]];
try {
  console.log(typeof SQL, new SQL(${url}) instanceof SQL);
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
  expect(answer.stdout).toBe("function true\n");
});

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
  const used = await membersUsed(`${behindCalls(calls, "", reads)}console.log(holder${calls}.next().length);\n`);
  expect(names.filter(name => !used.includes(name))).toEqual([]);
});
