// A member of Bun that the program names is in the executable, however late the compiler comes to the name. Here Bun has gone into hands that nobody follows, a store under a key that
// nobody knows may have hit the global of that name, and the name stands behind calls whose callees are found one after the other. Once only a function of Bun was found there:
// `new Bun.SQL()`, whose class a module of Bun makes at the first read, threw "Bun.SQL was not compiled into this executable because your code never uses it".
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, eachRow, test } from "./supported";

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
    [
      "named on what Promise.all() resolves to",
      "",
      `async () => {\n    const [bun] = await Promise.all([Bun]);\n    return new bun.SQL(${url});\n  }`,
    ],
    ["named on what Promise.race() resolves to", "", `async () => new (await Promise.race([Bun])).SQL(${url})`],
    ["named on what Promise.any() resolves to", "", `async () => new (await Promise.any([Bun])).SQL(${url})`],
    ["named on the descriptors of Bun", "", `() => new (Object.getOwnPropertyDescriptors(Bun).SQL.value)(${url})`],
    [
      "named on an object made of the entries of Bun",
      "",
      `() => new (Object.fromEntries(Object.entries(Bun)).SQL)(${url})`,
    ],
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
    [
      "named on an object created with the descriptors of Bun",
      "",
      `() => new (Object.create(null, Object.getOwnPropertyDescriptors(Bun)).SQL)(${url})`,
    ],
    [
      "named on an object created below another with the descriptors of Bun",
      "",
      `() => new (Object.create({}, Object.getOwnPropertyDescriptors(Bun)).SQL)(${url})`,
    ],
    [
      "named on an object created with a copy of the descriptors of Bun",
      "",
      `() => new (Object.create(null, { ...Object.getOwnPropertyDescriptors(Bun) }).SQL)(${url})`,
    ],
    [
      "named on an object created with the descriptors of a parameter",
      "",
      `() => new ((host => Object.create(null, Object.getOwnPropertyDescriptors(host)))(Bun).SQL)(${url})`,
    ],
    [
      "named on the descriptors of a spread copy",
      "",
      `() => new (Object.getOwnPropertyDescriptors({ ...Bun }).SQL.value)(${url})`,
    ],
    [
      "taken out of the descriptors of a spread copy by a pattern",
      "",
      `() => {\n    const {\n      SQL: { value },\n    } = Object.getOwnPropertyDescriptors({ ...Bun });\n    return new value(${url});\n  }`,
    ],
    [
      "named on the descriptors of a copy by Object.assign",
      "",
      `() => new (Object.getOwnPropertyDescriptors(Object.assign({}, Bun)).SQL.value)(${url})`,
    ],
    [
      "named on an object created with the descriptors of a spread copy",
      "",
      `() => new (Object.create(null, Object.getOwnPropertyDescriptors({ ...Bun })).SQL)(${url})`,
    ],
    [
      "named on the descriptors of an object created with the descriptors of Bun",
      "",
      `() =>\n    new (Object.getOwnPropertyDescriptors(Object.create(null, Object.getOwnPropertyDescriptors(Bun))).SQL.value)(${url})`,
    ],
    [
      "named on the descriptors of an object defined with the descriptors of Bun",
      "",
      `() =>\n    new (Object.getOwnPropertyDescriptors(Object.defineProperties({}, Object.getOwnPropertyDescriptors(Bun))).SQL.value)(\n      ${url},\n    )`,
    ],
    [
      "named on a copy defined descriptor by descriptor",
      "",
      `() => {\n    const all = Object.getOwnPropertyDescriptors(Bun);\n    const copy = {};\n    for (const key in all) Object.defineProperty(copy, key, all[key]);\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named on an object made of the entries of a spread copy",
      "",
      `() => new (Object.fromEntries(Object.entries({ ...Bun })).SQL)(${url})`,
    ],
    [
      "named on an object made of entries that a callback made anew",
      "",
      `() => new (Object.fromEntries(Object.entries(Bun).map(([key, value]) => [key, value])).SQL)(${url})`,
    ],
    [
      "named on an object made of the own keys of Bun and what is read under them",
      "",
      `() => new (Object.fromEntries(Reflect.ownKeys(Bun).map(key => [key, Bun[key]])).SQL)(${url})`,
    ],
    [
      "named on an object made of the own keys of Bun and what Reflect.get reads",
      "",
      `() => new (Object.fromEntries(Reflect.ownKeys(Bun).map(key => [key, Reflect.get(Bun, key)])).SQL)(${url})`,
    ],
    [
      "named on an object made of the keys of Bun and what is read under them",
      "",
      `() => new (Object.fromEntries(Object.keys(Bun).map(key => [key, Bun[key]])).SQL)(${url})`,
    ],
    [
      "named on an object made of a map of the entries of Bun",
      "",
      `() => new (Object.fromEntries(new Map(Object.entries(Bun))).SQL)(${url})`,
    ],
    ["asked of a map of the entries of Bun", "", `() => new (new Map(Object.entries(Bun)).get("SQL"))(${url})`],
    [
      "named on a copy filled by for-in",
      "",
      `() => {\n    const copy = {};\n    for (const key in Bun) copy[key] = Bun[key];\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named on a copy filled over Object.keys",
      "",
      `() => {\n    const copy = {};\n    for (const key of Object.keys(Bun)) copy[key] = Bun[key];\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named on a copy filled over Object.getOwnPropertyNames",
      "",
      `() => {\n    const copy = {};\n    for (const key of Object.getOwnPropertyNames(Bun)) copy[key] = Bun[key];\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named on a copy filled over Reflect.ownKeys by Reflect.get",
      "",
      `() => {\n    const copy = {};\n    for (const key of Reflect.ownKeys(Bun)) copy[key] = Reflect.get(Bun, key);\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named on a copy filled over Reflect.ownKeys by Reflect.set",
      "",
      `() => {\n    const copy = {};\n    for (const key of Reflect.ownKeys(Bun)) Reflect.set(copy, key, Reflect.get(Bun, key));\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named on a copy filled over Object.entries",
      "",
      `() => {\n    const copy = {};\n    for (const [key, value] of Object.entries(Bun)) copy[key] = value;\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named on a copy filled by a callback",
      "",
      `() => {\n    const copy = {};\n    Object.keys(Bun).forEach(key => {\n      copy[key] = Bun[key];\n    });\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named on a copy filled by reduce",
      "",
      `() =>\n    new (Reflect.ownKeys(Bun).reduce((copy, key) => {\n      copy[key] = Bun[key];\n      return copy;\n    }, {}).SQL)(${url})`,
    ],
    [
      "named on an object made of pairs that promises resolved to",
      "",
      `async () =>\n    new (Object.fromEntries(await Promise.all(Object.entries(Bun).map(async ([key, value]) => [key, value]))).SQL)(${url})`,
    ],
    [
      "named on an object made of pairs that a generator yields",
      `function* pairs() {\n  for (const key in Bun) yield [key, Bun[key]];\n}\n`,
      `() => new (Object.fromEntries(pairs()).SQL)(${url})`,
    ],
    [
      "named on an object made of the values of the descriptors of Bun",
      "",
      `() =>\n    new (Object.fromEntries(\n      Object.entries(Object.getOwnPropertyDescriptors(Bun)).map(([key, descriptor]) => [key, descriptor.value]),\n    ).SQL)(${url})`,
    ],
    [
      "named on the descriptors of Bun and defined under another name",
      "",
      `() => new (Object.defineProperty({}, "other", Object.getOwnPropertyDescriptors(Bun).SQL).other)(${url})`,
    ],
    [
      "asked of a map that a loop filled",
      "",
      `() => {\n    const map = new Map();\n    for (const key in Bun) map.set(key, Bun[key]);\n    return new (map.get("SQL"))(${url});\n  }`,
    ],
    [
      "named on an instance that its constructor filled",
      `class Copy {\n  constructor(host) {\n    for (const key in host) this[key] = host[key];\n  }\n}\n`,
      `() => new (new Copy(Bun).SQL)(${url})`,
    ],
    [
      "named on a copy whose getters read Bun",
      "",
      `() => {\n    const copy = {};\n    for (const key of Object.getOwnPropertyNames(Bun)) Object.defineProperty(copy, key, { get: () => Bun[key] });\n    return new copy.SQL(${url});\n  }`,
    ],
    [
      "named as a global after Bun was assigned onto the global object",
      "",
      `() => {\n    Object.assign(globalThis, Bun);\n    return new SQL(${url});\n  }`,
    ],
    [
      "named as a global after a loop stored the members on the global object",
      "",
      `() => {\n    for (const key in Bun) globalThis[key] = Bun[key];\n    return new SQL(${url});\n  }`,
    ],
    [
      "named on the rest of a pattern",
      "",
      `() => {\n    const { ...rest } = Bun;\n    return new rest.SQL(${url});\n  }`,
    ],
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

// What a copy of process or of the global object holds is found under its name as well.
describe.concurrent("named on what was made of all the properties of another built-in object", () => {
  eachRow<[string, string]>([
    [
      "the loader of process, on an object created with the descriptors of process",
      `Object.create(null, Object.getOwnPropertyDescriptors(process)).getBuiltinModule("node:os").cpus`,
    ],
    [
      "the loader of process, taken out of the descriptors of process by a pattern",
      `(({ getBuiltinModule }) => getBuiltinModule.value)(Object.getOwnPropertyDescriptors(process))("node:os").cpus`,
    ],
    [
      "the loader of process, on the descriptors of a spread copy",
      `Object.getOwnPropertyDescriptors({ ...process }).getBuiltinModule.value("node:os").cpus`,
    ],
    [
      "the loader of process, on a copy of the descriptors of process",
      `({ ...Object.getOwnPropertyDescriptors(process) }).getBuiltinModule.value("node:os").cpus`,
    ],
    [
      "the loader of process, on an object made of the entries of the descriptors of process",
      `Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(process))).getBuiltinModule.value("node:os").cpus`,
    ],
    [
      "the loader of process, asked of a map of the entries of process",
      `new Map(Object.entries(process)).get("getBuiltinModule")("node:os").cpus`,
    ],
    [
      "a class of Bun, on a proxy whose trap reads Bun under the key",
      `new (new Proxy({}, { get: (target, key) => Bun[key] }).SQL)(${url})`,
    ],
    [
      "a class of Bun, on a proxy whose trap asks Reflect.get",
      `new (new Proxy({}, { get: (target, key) => Reflect.get(Bun, key) }).SQL)(${url})`,
    ],
    [
      "a class of Bun, on an object created with the descriptors of the global object",
      `new (Object.create(null, Object.getOwnPropertyDescriptors(globalThis)).Bun.SQL)(${url})`,
    ],
    [
      "a class of Bun, on the descriptors of a spread copy of the global object",
      `new (Object.getOwnPropertyDescriptors({ ...globalThis }).Bun.value.SQL)(${url})`,
    ],
    [
      "a class of Bun, on an object made of the entries of the descriptors of the global object",
      `new (Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(globalThis))).Bun.value.SQL)(${url})`,
    ],
  ])("%s", async (_, read) => {
    using dir = tempDir("aot-members-of-bun-named-late", { "program.mjs": `console.log(typeof ${read});\n` });
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

test.concurrent.each([
  ["its name", (name: string) => `Bun.${name}`],
  ["Reflect.get", (name: string) => `Reflect.get(Bun, "${name}")`],
  ["Reflect.getOwnPropertyDescriptor", (name: string) => `Reflect.getOwnPropertyDescriptor(Bun, "${name}")`],
])("every member of Bun that is read by %s counts as used, early or late", async (_, read) => {
  const names = Reflect.ownKeys(Bun).filter(
    key => typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key),
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
