// Every function and method of Bun, Node and the web that the table of built-ins lists is called with operands that carry code of the program: conversions, getters, members that are
// called, proxies, heirs of built-in classes that override every member, and members added to the prototypes of primitives and built-in classes. Each piece of code counts in a variable of
// its own, in a field and in an element, which the case reads before the call and again behind it. The calls follow from the table (fuzz/fuzzilli/list-builtins.ts), so a new row is called too.
//
//   bun built-ins-given-operands-that-run-code.ts <list.json of list-builtins.ts>                       prints what can be called, as JSON
//   bun built-ins-given-operands-that-run-code.ts <list.json> <folder> [regular expression of names]    writes the programs there, CASES_IN_ONE_PROGRAM (150) each; FAMILIES="own inherited single"
//
// Code that one call of a program may run is code that may run anywhere in it: at default flags a case shows what its own call is taken to do only in a program of its own
// (CASES_IN_ONE_PROGRAM=1). A build with --aot-validate asks at each call.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Parameter = { type: string[]; isOptional: boolean; isCallback: boolean; members: string[]; handlers: string[][] };
type Signature = { parameters: Parameter[]; result: string[] };
export type List = { calls: Call[]; groups: Group[] };
type Call = Signature & { root: string; path: string[]; constructs: boolean };
type Group = { name: string; properties: Record<string, string[]>; methods: Record<string, Signature> };

const directives = "%j %o %O %s %d %i %f %c";
const samplesOfEngineTypes: Record<string, string> = {
  array: "[1]",
  promise: "Promise.resolve(1)",
  uint8array: "new Uint8Array(4)",
  arraybuffer: "new ArrayBuffer(4)",
  map: "new Map([[1, 1]])",
  set: "new Set([1])",
  date: "new Date(0)",
  regexp: "/a/",
};
function sampleOf(type: string[], makers: Map<string, string>): string | null {
  const literals = type.find(each => each.startsWith("enum:"));
  if (literals) return JSON.stringify(literals.slice(5).split("|")[0]);
  if (type.includes("string")) return JSON.stringify(directives);
  if (type.includes("integer") || type.includes("number") || type.includes("anything")) return "1";
  if (type.includes("boolean")) return "true";
  if (type.includes("function")) return "function () {}";
  for (const each of type) if (samplesOfEngineTypes[each]) return samplesOfEngineTypes[each];
  if (type.includes("object")) return "{}";
  for (const each of type)
    if (each.startsWith("group:") && makers.has(each.slice(6))) return makers.get(each.slice(6))!;
  if (type.includes("bigint")) return "1n";
  if (type.includes("undefined")) return "undefined";
  return null;
}

const isName = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);

async function answersAnObject(text: string): Promise<boolean> {
  try {
    const value = new Function("require", `return ${text};`)(require);
    return typeof value === "object" && value !== null && !(value instanceof Promise);
  } catch {
    return false;
  }
}

export type Callable = {
  label: string;
  callee: string;
  constructs: boolean;
  signature: Signature;
  /** An operand for each parameter that the function is likely to take, or null. */
  samples: (string | null)[];
};

const textOfCall = (callable: Pick<Callable, "callee" | "constructs">, operands: string[]) =>
  `${callable.constructs ? "new " : ""}${callable.callee}(${operands.join(", ")})`;

/** It makes calls, to find an instance of each class: whatever call of the list answers one with the samples. */
export async function listCallables(list: List): Promise<Callable[]> {
  const makers = new Map<string, string>();
  const groups = new Map(list.groups.map(group => [group.name, group]));
  const methodsOf = (name: string) => Object.entries(groups.get(name)?.methods ?? {});
  const statics = list.calls.map(call => ({
    label: [call.root.replace(/^require\("(.*)"\)$/, "$1"), ...call.path].join("."),
    callee: [call.root, ...call.path].join("."),
    constructs: call.constructs,
    signature: { parameters: call.parameters, result: call.result },
  }));
  for (let round = 0; round < 3; round++) {
    const known = [...statics];
    for (const [name, maker] of makers)
      for (const [method, signature] of methodsOf(name))
        known.push({ label: "", callee: `${maker}.${method}`, constructs: false, signature });
    for (const callable of known) {
      const made = callable.signature.result.filter(each => each.startsWith("group:")).map(each => each.slice(6));
      if (made.length !== 1 || makers.has(made[0])) continue;
      const required = callable.signature.parameters.filter(parameter => !parameter.isOptional);
      const operands = required.map(parameter => sampleOf(parameter.type, makers));
      if (operands.includes(null)) continue;
      const text = textOfCall(callable, operands as string[]);
      if (text.length < 300 && (await answersAnObject(text))) makers.set(made[0], text);
    }
  }
  const methods = [...makers].flatMap(([name, maker]) =>
    methodsOf(name)
      .filter(([method]) => isName(method))
      .map(([method, signature]) => ({
        label: `%${name}%.prototype.${method}`,
        callee: `(${maker}).${method}`,
        constructs: false,
        signature,
      })),
  );
  return [...statics, ...methods].map(callable => ({
    ...callable,
    samples: callable.signature.parameters.map(parameter => sampleOf(parameter.type, makers)),
  }));
}

// What an operand carries. `hook(name)` is the text that says the code under that name ran.
type Hook = (name: string) => string;
type Kind = {
  name: string;
  family: "own" | "inherited" | "single";
  write(hook: Hook, members: string[]): { before: string[]; operand: string };
};

const keyText = (name: string) =>
  name.startsWith("@@@")
    ? `[Symbol.for(${JSON.stringify(name.slice(3))})]`
    : name.startsWith("@@")
      ? `[Symbol.${name.slice(2)}]`
      : isName(name)
        ? name
        : `[${JSON.stringify(name)}]`;
const keyOf = (name: string): PropertyKey =>
  name.startsWith("@@@") ? Symbol.for(name.slice(3)) : name.startsWith("@@") ? (Symbol as any)[name.slice(2)] : name;
const memberText = (holder: string, name: string) =>
  keyText(name).startsWith("[") ? holder + keyText(name) : `${holder}.${name}`;
const readNames = [
  "then",
  "length",
  "constructor",
  "toJSON",
  "name",
  "message",
  "stack",
  "size",
  "@@toStringTag",
  "@@iterator",
  "@@asyncIterator",
  "@@toPrimitive",
  "@@@nodejs.util.inspect.custom",
];
const traps = [
  "get",
  "set",
  "has",
  "deleteProperty",
  "ownKeys",
  "getOwnPropertyDescriptor",
  "defineProperty",
  "getPrototypeOf",
  "setPrototypeOf",
  "isExtensible",
  "preventExtensions",
  "apply",
  "construct",
];
const proxyOf = (target: string) => (hook: Hook) => ({
  before: [],
  operand: `new Proxy(${target}, { ${traps.map(trap => `${trap}(...operands) { ${hook(trap)} return Reflect.${trap}(...operands); }`).join(", ")} })`,
});
// A function that is an own enumerable member or the operand itself may be turned into text. An arrow function around one expression is one line in plain Bun and in an executable.
const arrow = (hook: Hook, name: string, answer: string, parameters = "") =>
  `(${parameters}) => (${hook(name).replace(/;$/, "").replaceAll("; ", ", ")}, ${answer})`;
const calledMembers = (hook: Hook) =>
  [
    `toJSON: ${arrow(hook, "toJSON", '"j"')}`,
    `[Symbol.for("nodejs.util.inspect.custom")]: ${arrow(hook, "inspect", '"i"')}`,
    `[Symbol.iterator]: ${arrow(hook, "iterator", "[1][Symbol.iterator]()")}`,
    `[Symbol.asyncIterator]: ${arrow(hook, "asyncIterator", "{ next: () => Promise.resolve({ done: true, value: undefined }) }")}`,
    `then: ${arrow(hook, "then", "resolve(1)", "resolve")}`,
    `toISOString: ${arrow(hook, "toISOString", '"d"')}`,
  ].join(", ");

function heirOf(base: string, passed: string): Kind["write"] {
  return hook => {
    const prototype = (globalThis as any)[base].prototype;
    const parts: string[] = [`static get [Symbol.species]() { ${hook("species")} return ${base}; }`];
    for (let holder = prototype; holder && holder !== Object.prototype; holder = Object.getPrototypeOf(holder))
      for (const key of Reflect.ownKeys(holder)) {
        if (key === "constructor") continue;
        const name = typeof key === "symbol" ? `@@${key.description!.slice(7)}` : key;
        if (parts.some(part => part.includes(` ${keyText(name)}(`))) continue;
        const descriptor = Object.getOwnPropertyDescriptor(holder, key)!;
        if (descriptor.get) parts.push(`get ${keyText(name)}() { ${hook(name)} return ${memberText("super", name)}; }`);
        else if (typeof descriptor.value === "function")
          parts.push(
            ` ${keyText(name)}(...operands) { ${hook(name)} return ${memberText("super", name)}(...operands); }`,
          );
      }
    return { before: [`class Heir extends ${base} { ${parts.join(" ")} }`], operand: `new Heir(${passed})` };
  };
}

// An executable lets a program add these to the prototype of a built-in class: docs/compiler/compatibility.mdx, "Built-in objects are read-only".
const primitiveHolders = ["Number", "String", "Boolean", "BigInt", "Symbol"];
const inherited =
  (holder: string, operand: string): Kind["write"] =>
  (hook, members) => {
    const before: string[] = [];
    const prototype = (globalThis as any)[holder].prototype;
    const mayBeAdded = (name: string) =>
      !(keyOf(name) in prototype) &&
      !/^@@[a-zA-Z]/.test(name) &&
      !/^\d+$|^(next|return|throw)$/.test(name) &&
      (name !== "then" || primitiveHolders.includes(holder)) &&
      (name !== "toJSON" || [...primitiveHolders, "Map", "Set", "Error"].includes(holder));
    for (const [name, answer] of [
      ["toJSON", '"j"'],
      ["@@@nodejs.util.inspect.custom", '"i"'],
      ["toISOString", '"d"'],
    ])
      if (mayBeAdded(name))
        before.push(`${memberText(`${holder}.prototype`, name)} = function () { ${hook(name)} return ${answer}; };`);
    for (const name of new Set(["then", "length", "size", "cause", "code", "errors", ...members]))
      if (mayBeAdded(name))
        before.push(
          `Object.defineProperty(${holder}.prototype, ${JSON.stringify(name)}, { configurable: true, get() { ${hook(name)} return undefined; } });`,
        );
    return { before, operand };
  };

const kinds: Kind[] = [
  {
    name: "to-primitive",
    family: "own",
    write: hook => ({
      before: [],
      operand: `{ [Symbol.toPrimitive]: ${arrow(hook, "toPrimitive", 'hint === "number" ? 1 : "s"', "hint")} }`,
    }),
  },
  {
    name: "to-string-and-value-of",
    family: "own",
    write: hook => ({
      before: [],
      operand: `{ toString: ${arrow(hook, "toString", "{}")}, valueOf: ${arrow(hook, "valueOf", "1")} }`,
    }),
  },
  {
    name: "getters",
    family: "own",
    write: (hook, members) => ({
      before: [],
      operand: `{ ${[...new Set([...readNames, ...members])].map(name => `get ${keyText(name)}() { ${hook(name)} return undefined; }`).join(", ")} }`,
    }),
  },
  { name: "called-members", family: "own", write: hook => ({ before: [], operand: `{ ${calledMembers(hook)} }` }) },
  { name: "proxy-of-an-object", family: "own", write: proxyOf("{ a: 1 }") },
  { name: "proxy-of-an-array", family: "own", write: proxyOf("[1]") },
  { name: "proxy-of-a-function", family: "own", write: proxyOf("function () {}") },
  {
    name: "array-of-objects",
    family: "own",
    write: hook => ({
      before: [],
      operand: `[{ [Symbol.toPrimitive]: ${arrow(hook, "toPrimitive", "1")}, ${calledMembers(hook)} }]`,
    }),
  },
  {
    name: "array-with-an-accessor",
    family: "own",
    write: hook => ({
      before: [],
      operand: `Object.defineProperty([0, 0], 0, { get() { ${hook("element")} return 1; } })`,
    }),
  },
  {
    name: "function-with-members",
    family: "own",
    write: (hook, members) => ({
      before: [],
      operand: `Object.assign(${arrow(hook, "call", "undefined")}, { ${calledMembers(hook)} })`,
    }),
  },
  {
    name: "instance-of-a-class",
    family: "own",
    write: hook => ({
      before: [
        `class Named { static get name() { ${hook("name")} return "N"; } get [Symbol.toStringTag]() { ${hook("toStringTag")} return "T"; } }`,
      ],
      operand: "new Named()",
    }),
  },
  { name: "heir-of-array", family: "own", write: heirOf("Array", "1, 2") },
  { name: "heir-of-uint8array", family: "own", write: heirOf("Uint8Array", "4") },
  { name: "heir-of-map", family: "own", write: heirOf("Map", "[[1, 1]]") },
  { name: "heir-of-set", family: "own", write: heirOf("Set", "[1]") },
  { name: "heir-of-date", family: "own", write: heirOf("Date", "0") },
  { name: "heir-of-regexp", family: "own", write: heirOf("RegExp", '"a"') },
  { name: "heir-of-promise", family: "own", write: heirOf("Promise", "resolve => resolve(1)") },
  { name: "heir-of-error", family: "own", write: heirOf("Error", '"m"') },
  { name: "heir-of-array-buffer", family: "own", write: heirOf("ArrayBuffer", "4") },
  { name: "number", family: "inherited", write: inherited("Number", "1.5") },
  { name: "string", family: "inherited", write: inherited("String", '"s"') },
  { name: "boolean", family: "inherited", write: inherited("Boolean", "true") },
  { name: "bigint", family: "inherited", write: inherited("BigInt", "1n") },
  { name: "symbol", family: "inherited", write: inherited("Symbol", 'Symbol("y")') },
  { name: "array", family: "inherited", write: inherited("Array", "[1]") },
  { name: "map", family: "inherited", write: inherited("Map", "new Map([[1, 1]])") },
  { name: "set", family: "inherited", write: inherited("Set", "new Set([1])") },
  { name: "date", family: "inherited", write: inherited("Date", "new Date(0)") },
  { name: "uint8array", family: "inherited", write: inherited("Uint8Array", "new Uint8Array(4)") },
  { name: "buffer", family: "inherited", write: inherited("Buffer", "Buffer.alloc(4)") },
  { name: "array-buffer", family: "inherited", write: inherited("ArrayBuffer", "new ArrayBuffer(4)") },
  { name: "error", family: "inherited", write: inherited("Error", 'new Error("m")') },
];

// A call that throws reads everything again on its way to the handler, so the directives that refuse some operand are apart from the others.
const textsOfDirectives = ["%j %o %O %c", "%s", "%d %i %f"];

// One piece of code an operand: a call that is taken to run other code of the operand, and not this, is taken to run none.
const singleMethods: Record<string, string> = {
  toString: '"s"',
  valueOf: "1",
  "@@toPrimitive": "1",
  toJSON: '"j"',
  "@@@nodejs.util.inspect.custom": '"i"',
  "@@iterator": "[1][Symbol.iterator]()",
  "@@asyncIterator": "{ next: () => Promise.resolve({ done: true, value: undefined }) }",
  toISOString: '"d"',
  then: "undefined",
};
const singleKindsOf = (members: string[]): Kind[] => [
  ...Object.entries(singleMethods).map(
    ([name, answer]): Kind => ({
      name: `method-${name}`,
      family: "single",
      write: hook => ({ before: [], operand: `{ ${keyText(name)}: ${arrow(hook, name, answer)} }` }),
    }),
  ),
  ...[...new Set([...readNames, ...members])].map(
    (name): Kind => ({
      name: `getter-${name}`,
      family: "single",
      write: hook => ({ before: [], operand: `{ get ${keyText(name)}() { ${hook(name)} return undefined; } }` }),
    }),
  ),
  ...traps.map(
    (trap): Kind => ({
      name: `trap-${trap}`,
      family: "single",
      write: hook => ({
        before: [],
        operand: `new Proxy(${trap === "apply" || trap === "construct" ? "function () {}" : "{ a: 1 }"}, { ${trap}(...operands) { ${hook(trap)} return Reflect.${trap}(...operands); } })`,
      }),
    }),
  ),
];
const membersOf = (parameter: Parameter | undefined) =>
  [...(parameter?.members ?? []), ...(parameter?.handlers ?? []).map(path => path[0])].filter(
    name => name !== "__proto__",
  );

function writeCase(index: number, callable: Callable, position: number, kind: Kind, text: string): string | null {
  const { parameters } = callable.signature;
  const defaults = callable.samples.slice(0, position);
  if (defaults.includes(null)) return null;
  const lastText = defaults.lastIndexOf(JSON.stringify(directives));
  if (lastText === -1 && text !== textsOfDirectives[0]) return null;
  if (lastText !== -1) defaults[lastText] = JSON.stringify(text);
  const names: string[] = [];
  const hook: Hook = name => {
    if (!names.includes(name)) names.push(name);
    return `h${names.indexOf(name)}++; holder.field++; elements[0]++;`;
  };
  const parameter = parameters[position];
  const members = membersOf(parameter);
  const { before, operand } = kind.write(hook, members);
  const isLast = position >= parameters.length - 1;
  const operands = [
    ...(defaults as string[]),
    ...Array(isLast ? 8 : 1).fill("operand"),
    ...(isLast ? [] : callable.samples.slice(position + 1).map(each => each ?? "undefined")),
  ];
  const variables = names.map((_, each) => `h${each}`);
  const places = [...variables, "holder.field", "elements[0]"];
  return [
    `function case${index}() {`,
    `  let ${variables.map(each => `${each} = 0`).join(", ")};`,
    `  const holder = { field: 0 }, elements = [0];`,
    ...(callable.callee.startsWith("require(")
      ? [`  ${callable.callee.slice(0, callable.callee.indexOf(")") + 1)};`]
      : []),
    ...before.map(line => `  ${line}`),
    `  const operand = ${operand};`,
    `  const ${places.map((place, each) => `b${each} = ${place}`).join(", ")};`,
    `  let outcome, caught;`,
    `  try { outcome = typeof ${textOfCall(callable, operands)}; } catch (error) { outcome = "throws"; caught = error; }`,
    `  const ${places.map((place, each) => `a${each} = ${place}`).join(", ")};`,
    `  return [${JSON.stringify(`${callable.label} ${position} ${kind.name}${lastText === -1 ? "" : ` ${text}`}`)}, ${JSON.stringify(names.join(" "))}, outcome, caught, [${places.map((_, each) => `b${each}`).join(", ")}], [${places.map((_, each) => `a${each}`).join(", ")}], () => [${places.join(", ")}]];`,
    `}`,
  ].join("\n");
}

// What the built-ins themselves print is not compared: the program starts itself again with nothing to print to, its cases write their lines to the file that AOT_LINES_FILE names, and it prints that file.
// Whoever sets AOT_LINES_FILE gets the cases at once, from the one whose number is in process.argv[2] on.
// Plain Bun describes an operand that a native function rejects by running code of the operand, and an executable does not (docs/compiler/compatibility.mdx): a case whose call throws says no more
// than that, unless AOT_EVERY_LINE is set. Then each case also says what it reads a little later, which hangs on the clock.
const epilogue = (count: number) => `
const fs = require("node:fs");
if (!process.env.AOT_LINES_FILE) {
  const file = require("node:path").join(require("node:os").tmpdir(), "lines-of-" + process.pid + ".txt");
  const isExecutable = /[$]bunfs|~BUN/.test(process.argv[1]);
  const folder = fs.mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "files-of-the-cases-"));
  const child = require("node:child_process").spawnSync(process.execPath, isExecutable ? [] : [process.argv[1]], { cwd: folder, env: { ...process.env, AOT_LINES_FILE: file }, stdio: ["ignore", "ignore", "pipe"] });
  fs.rmSync(folder, { recursive: true, force: true });
  console.log(fs.readFileSync(file, "utf8"));
  console.log(String(child.stderr).split("\\n").filter(line => line.startsWith("AOT ")).join("\\n"));
  console.log("ended with", child.status, child.signal);
  fs.rmSync(file);
  process.exit(0);
}
process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});
const cases = [${Array.from({ length: count }, (_, index) => `case${index}`).join(", ")}];
const lines = fs.openSync(process.env.AOT_LINES_FILE, "a");
const write = text => fs.writeSync(lines, "@@ " + text + "\\n");
const readLater = [];
for (let chosen = Number(process.argv[2] ?? 0); chosen < cases.length; chosen++) {
  const [label, names, outcome, caught, before, behind, later] = cases[chosen]();
  if (outcome === "throws" && !process.env.AOT_EVERY_LINE) {
    write(chosen + " | " + label + " | throws " + (caught instanceof Error ? caught.name : typeof caught));
    continue;
  }
  write(chosen + " | " + label + " | " + outcome + (outcome === "throws" ? " " + (caught instanceof Error ? caught.name : typeof caught) : "") + " | " + before.join() + " | " + behind.join() + " | " + names);
  if (process.env.AOT_EVERY_LINE) readLater.push([chosen, later]);
}
setTimeout(() => { for (const [chosen, later] of readLater) write(chosen + " later " + later().join()); write("end"); process.exit(0); }, 50);
`;

export const families = ["own", "inherited", "single"] as const;

/** The cases of some functions with the operands of one family, as programs of at least so many cases. A function's cases at one position stay together. */
export function programsOf(callables: Callable[], family: Kind["family"], casesInOneProgram: number): string[] {
  const programs: string[] = [];
  let texts: string[] = [];
  const flush = () => {
    if (texts.length > 0) programs.push(texts.join("\n") + epilogue(texts.length));
    texts = [];
  };
  for (const callable of callables)
    for (let position = 0; position <= callable.signature.parameters.length; position++)
      for (const directive of textsOfDirectives) {
        const ofFamily =
          family === "single"
            ? singleKindsOf(membersOf(callable.signature.parameters[position]))
            : kinds.filter(kind => kind.family === family);
        for (const kind of ofFamily) {
          const text = writeCase(texts.length, callable, position, kind, directive);
          if (text !== null) texts.push(text);
        }
        if (texts.length >= casesInOneProgram) flush();
      }
  flush();
  return programs;
}

if (import.meta.main) {
  const [listPath, folder, filterText] = process.argv.slice(2);
  const callables = await listCallables(JSON.parse(await Bun.file(listPath).text()));
  if (folder === undefined) console.log(JSON.stringify(callables));
  else {
    mkdirSync(folder, { recursive: true });
    const filter = new RegExp(filterText ?? ".");
    const chosen = callables.filter(callable => filter.test(callable.label));
    let count = 0;
    for (const family of (process.env.FAMILIES ?? "own inherited single").split(" ") as Kind["family"][])
      for (const text of programsOf(chosen, family, Number(process.env.CASES_IN_ONE_PROGRAM) || 150))
        writeFileSync(join(folder, `${family}-${String(count++).padStart(5, "0")}.js`), text);
    console.log(`${chosen.length} of ${callables.length} functions, ${count} programs`);
  }
  process.exit(0);
}
