// Programs that read members of the built-ins by their literal spelling and ask in place what they are. A question that goes through a helper cannot see a false belief of the compiler:
// the parameter of the helper sees values of all kinds. The members are those of the Bun that runs this file: what is reached by names and symbols, own and inherited, from the globals, from
// instances and from the built-in modules. Of each kind of member a few are taken.
//
//   bun members.fixture.ts <family>             prints the programs of that family as JSON
//   bun members.fixture.ts --families           prints the names of the families
//
// The walk runs in a process of its own, started as the programs are: what `process.stdout` is depends on where it goes, and the realm of a test file holds what its helpers add. Each module is
// walked in a process of its own too: modules leave marks on one another, and a program loads only what it names.
import { builtinModules } from "node:module";

interface Member {
  read: string;
  base: string;
  key: string;
  kind: string;
  throws: boolean;
  isOfPrimitive: boolean;
  isBinding: boolean;
  setup?: string;
}

const wellKnownSymbols = new Map<symbol, string>();
for (const name of Object.getOwnPropertyNames(Symbol))
  if (typeof (Symbol as any)[name] === "symbol") wellKnownSymbols.set((Symbol as any)[name], "Symbol." + name);

const isIdentifier = (text: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);

function spellKey(key: string | symbol): string | undefined {
  if (typeof key === "string") return JSON.stringify(key);
  if (wellKnownSymbols.has(key)) return wellKnownSymbols.get(key);
  const registered = Symbol.keyFor(key);
  return registered === undefined ? undefined : `Symbol.for(${JSON.stringify(registered)})`;
}

const spellMember = (base: string, key: string | symbol) =>
  typeof key === "string" && isIdentifier(key) ? base + "." + key : base + "[" + spellKey(key) + "]";

// Reading these opens a file, a channel or a debugger.
const neverRead =
  /^(stdin|openStdin|mainModule|binding|_linkedBinding|dlopen|debugPort|report|channel|connected|webkitURL)$/;
// A compiled program has no ShadowRealm. The others are the global object again or belong to the file.
const globalsLeftOut = new Set(
  "ShadowRealm globalThis self window global Loader $ require module exports __filename __dirname onmessage onerror name".split(
    " ",
  ),
);
// These depend on the machine, on how the program was started, or on what the executable contains.
const holdersLeftOut =
  /^(process\.env|Bun\.env|process\.versions|process\.release|process\.argv|process\.execArgv|Bun\.argv|require\.cache)$/;
const membersOfTheRun = /\.(isStandaloneExecutable|embeddedFiles)$/;
// `bun:test` answers outside a test run with functions that throw. The others start something when they are loaded, or print a warning.
const modulesLeftOut =
  /^(bun:test|bun:main|bun:wrap|bun:internal-for-testing|node:test|node:repl|node:cluster|node:_.*|node:sys|node:punycode)$/;
const deepest = 2;

function walk(
  found: Member[],
  path: unknown[],
  text: string,
  object: any,
  depth: number,
  setup?: string,
  isOfPrimitive = false,
) {
  if ((typeof object !== "object" && typeof object !== "function") || object === null) return;
  if (path.includes(object) || holdersLeftOut.test(text)) return;
  const listed = new Set<string | symbol>();
  const own: (string | symbol)[] = [];
  // A proxy may answer with a new object each time it is asked what stands above it.
  for (let holder = object, above = 0; holder !== null && holder !== undefined && above < 12; above++) {
    for (const key of Reflect.ownKeys(holder).slice(0, 600)) {
      if (listed.has(key) || spellKey(key) === undefined || key === "ShadowRealm") continue;
      listed.add(key);
      if (typeof key === "string" && (neverRead.test(key) || /^\d+$/.test(key))) continue;
      const described = Object.getOwnPropertyDescriptor(holder, key)!;
      // Bun does not come back from the getters of node:vm's Script on the prototype itself.
      if (object === require("node:vm").Script.prototype && described.get) continue;
      let answer = "throws";
      try {
        answer = typeof object[key];
      } catch {}
      const read = spellMember(text, key);
      if (membersOfTheRun.test(read)) continue;
      found.push({
        read,
        base: text,
        key: spellKey(key)!,
        kind: [
          above === 0 ? "own" : "inherited",
          answer,
          "value" in described ? "data" : "accessor",
          typeof key,
          typeof object,
        ].join(" "),
        throws: answer === "throws",
        isOfPrimitive,
        isBinding: false,
        setup,
      });
      if (above === 0 && answer !== "throws") own.push(key);
    }
    holder = Object.getPrototypeOf(holder);
  }
  if (depth >= deepest) return;
  for (const key of own)
    if (key !== "constructor") walk(found, [...path, object], spellMember(text, key), object[key], depth + 1, setup);
}

const instances = [
  `new URL("http://a.example/b?c=d#e")`,
  `new URLSearchParams("a=b")`,
  `new Headers({ a: "b" })`,
  `new Request("http://a.example/")`,
  `new Response("a")`,
  `new Blob(["a"])`,
  `new FormData()`,
  `new TextDecoder()`,
  `new TextEncoder()`,
  `new AbortController().signal`,
  `new CustomEvent("a", { detail: 1 })`,
  `new EventTarget()`,
  `new MessageChannel().port1`,
  `new DOMException("a")`,
  `new ReadableStream()`,
  `new Date(0)`,
  `/a/g`,
  `new Map()`,
  `new Set()`,
  `new WeakMap()`,
  `new WeakRef({})`,
  `new TypeError("a")`,
  `new ArrayBuffer(8)`,
  `new Uint8Array(2)`,
  `new Float64Array(2)`,
  `new DataView(new ArrayBuffer(8))`,
  `Promise.resolve(1)`,
  `[1, 2]`,
  `[1, 2].values()`,
  `new Map().entries()`,
  `"a".matchAll(/a/g)`,
  `function () {}`,
  `() => 1`,
  `class {}`,
  `async function () {}`,
  `(function* () {})()`,
  `(function () {}).bind(null)`,
  `/(?<a>a)/d.exec("a")`,
  `new Intl.NumberFormat()`,
  `new Intl.DateTimeFormat().resolvedOptions()`,
  `Iterator.from([1])`,
  `JSON.parse('{"a":1}')`,
  `"text"`,
  `12`,
  `1.5`,
  `true`,
  `12n`,
  `Symbol.iterator`,
  `Buffer.from("ab")`,
  `Bun.file("a")`,
  `new Bun.Glob("*")`,
  `new Bun.CryptoHasher("sha256")`,
  `new Bun.Cookie("a", "b")`,
  `new Bun.CookieMap()`,
  `new Temporal.PlainDate(2020, 1, 2)`,
  `new Temporal.Duration(1)`,
];

const formsOfBinding = [
  "named",
  "namespace",
  "default",
  "require",
  "destructured require",
  "import()",
  "getBuiltinModule",
] as const;

async function walkModule(name: string, number: number): Promise<Record<string, Member[]>> {
  const space: any = await import(name);
  const quoted = JSON.stringify(name);
  const found: Record<string, Member[]> = Object.fromEntries(formsOfBinding.map(form => [form, []]));
  walk(found.namespace, [], "space" + number, space, 0, `import * as space${number} from ${quoted};`);
  if ("default" in space)
    walk(found.default, [], "whole" + number, space.default, 0, `import whole${number} from ${quoted};`);
  walk(found.require, [], "required" + number, require(name), 0, `const required${number} = require(${quoted});`);
  walk(found["import()"], [], "awaited" + number, space, 0, `const awaited${number} = await import(${quoted});`);
  walk(
    found.getBuiltinModule,
    [],
    "gotten" + number,
    process.getBuiltinModule(name),
    0,
    `const gotten${number} = process.getBuiltinModule(${quoted});`,
  );
  const bind = (form: string, holder: any, spell: (key: string, bound: string) => string) =>
    Object.keys(holder)
      .filter(key => isIdentifier(key) && key !== "default" && !neverRead.test(key))
      .forEach((key, index) => {
        const bound = `${form[0]}${number}_${index}`;
        const setup = spell(key, bound);
        found[form].push({
          read: bound,
          base: `({ ${bound} })`,
          key: JSON.stringify(bound),
          kind: "a binding " + typeof holder[key],
          throws: false,
          isOfPrimitive: false,
          isBinding: true,
          setup,
        });
        walk(found[form], [], bound, holder[key], 1, setup);
      });
  bind("named", space, (key, bound) => `import { ${key} as ${bound} } from ${quoted};`);
  bind("destructured require", require(name), (key, bound) => `const { ${key}: ${bound} } = require(${quoted});`);
  return found;
}

function takeSomeOfEachKind(members: Member[], ofEach: number): Member[] {
  const kinds = Map.groupBy(members, member => member.kind);
  return [...kinds.values()].flatMap(all =>
    all.length <= ofEach
      ? all
      : Array.from({ length: ofEach }, (_, index) => all[Math.floor((index * (all.length - 1)) / (ofEach - 1))]),
  );
}

function writeReads({ read, base, key, throws, isOfPrimitive, isBinding }: Member, n: number): string {
  const label = JSON.stringify(read);
  const describe = `function described${n}() { const d = Object.getOwnPropertyDescriptor(${base}, ${key}); if (d === undefined) return "none"; return "value" in d ? "data " + typeof d.value : "accessor " + typeof d.get + " " + typeof d.set; }
function has${n}() { return (${key} in ${isOfPrimitive ? `Object(${base})` : base}) + " " + Object.hasOwn(${base}, ${key}); }`;
  if (throws)
    return `function kind${n}() { try { return typeof ${read}; } catch (error) { return "threw " + error.name; } }
${describe}
say(${label}, kind${n}(), described${n}(), has${n}());`;
  // The type of what such a function returns hangs on what the compiler believes of the value.
  const lengthOf = (text: string) =>
    `(v => { if (typeof v === "function") return v.length; return "no function"; })(${text})`;
  const name = /^"([A-Za-z_$][\w$]*)"$/.exec(key)?.[1];
  const ways: [string, string][] = [
    ["", read],
    [`function returned${n}() { return ${read}; }`, `returned${n}()`],
    [`function taken${n}(value) { return value; }`, `taken${n}(${read})`],
    [`const list${n} = [${read}];`, `list${n}[0]`],
    [`let written${n}; written${n} = ${read};`, `written${n}`],
    [`const map${n} = new Map([["k", ${read}]]);`, `map${n}.get("k")`],
    [`const object${n} = { held: ${read} };`, `object${n}.held`],
    [`class Holder${n} { held = ${read}; }`, `new Holder${n}().held`],
    [`class Static${n} { static held = ${read}; }`, `Static${n}.held`],
    [`const { [${key}]: destructured${n} } = ${base};`, `destructured${n}`],
    ["", `${base}?.[${key}]`],
    [`const key${n} = ${key};`, `${base}[key${n}]`],
    ["", `Reflect.get(${isOfPrimitive ? `Object(${base})` : base}, ${key})`],
    [`function byDefault${n}(v = ${read}) { return v; }`, `byDefault${n}()`],
    [`const held${n} = ${read}; const closure${n} = () => held${n};`, `closure${n}()`],
    [`const getter${n} = { get held() { return ${read}; } };`, `getter${n}.held`],
    [`function* generator${n}() { yield ${read}; }`, `generator${n}().next().value`],
    [`async function later${n}() { return [${read}]; }`, `(await later${n}())[0]`],
    ["", `({ ...{ held: ${read} } }).held`],
    ["", `[...[${read}]][0]`],
    [`const merged${n} = flag ? 1 : ${read};`, `merged${n}`],
    [`const either${n} = flag ? "text" : ${read};`, `either${n}`],
    [`function receiver${n}() { "use strict"; return this; }`, `receiver${n}.call(${read})`],
    [`function rest${n}(...all) { return all[0]; }`, `rest${n}(${read})`],
    [`function passed${n}() { return arguments[0]; }`, `passed${n}(${read})`],
    [
      `let late${n}; function write${n}() { late${n} = ${read}; } function readLate${n}() { return late${n}; } write${n}();`,
      `readLate${n}()`,
    ],
    [`const nested${n} = { a: { b: [${read}] } };`, `nested${n}.a.b[0]`],
    ["", `new Set([${read}]).values().next().value`],
    ["", `[${read}].map(each => each)[0]`],
    ["", `(() => { try { return ${read}; } finally { } })()`],
    ["", `(${read} ?? "nothing")`],
  ];
  if (name && !isBinding)
    ways.push(
      [`const { ${name}: short${n} } = ${base};`, `short${n}`],
      [`function unpack${n}({ ${name}: v }) { return v; }`, `unpack${n}(${base})`],
    );
  return `${ways
    .map(([setup]) => setup)
    .filter(Boolean)
    .join("\n")}
function name${n}() { return typeof ${read} === "function" ? ${read}?.name : "-"; }
function shape${n}() { const v = ${read}; if (v === undefined) return 1; if (v === null) return "null"; if (typeof v === "function") return 2.5; if (typeof v === "object") return [3]; if (typeof v === "string") return { s: 4 }; if (typeof v === "number") return true; if (typeof v === "boolean") return 5n; if (typeof v === "symbol") return -6; return "bigint"; }
function builds${n}() { try { Reflect.construct(Object, [], ${read}); return "constructor"; } catch { return "none"; } }
${describe}
say(${label}, String(name${n}()), typeof shape${n}(), String(shape${n}()), builds${n}(), described${n}(), has${n}(), ${read} instanceof Object, ${ways.map(([, text]) => `typeof ${text}, ${lengthOf(text)}`).join(", ")});`;
}

function writeProgram(members: Member[]): string {
  const setups = [...new Set(members.map(member => member.setup).filter(setup => setup !== undefined))];
  return [
    ...setups.filter(setup => setup.startsWith("import ")),
    `const say = (...words) => console.log(words.join(" "));`,
    `const flag = process.argv.length > 99;`,
    ...setups.filter(setup => !setup.startsWith("import ")),
    ...members.map(writeReads),
    `process.exit(0);`,
  ].join("\n");
}

if (import.meta.main && process.argv[2] === "--module") {
  console.log(JSON.stringify(await walkModule(process.argv[3], Number(process.argv[4]))));
  process.exit(0);
}

// A program of a whole family takes a compiler with sanitizers most of a test's time limit, and the module of one family, `named`, is so large that AddressSanitizer
// maps the shadow of its instructions anew at every step of one pass of the engine: 160 s before its first statement runs. So a family is asked in parts.
const partsOfFamily = 2;

if (import.meta.main && process.argv[2] === "--families") {
  console.log(JSON.stringify(["globals", "instances", ...formsOfBinding]));
  process.exit(0);
}

if (import.meta.main) {
  const family = process.argv[2];
  const families: Record<string, Member[]> = {
    globals: [],
    instances: [],
    ...Object.fromEntries(formsOfBinding.map(form => [form, []])),
  };
  if (!(family in families)) throw new Error(`no such family: ${family}`);
  for (const key of family === "globals" ? Object.getOwnPropertyNames(globalThis) : []) {
    if (!isIdentifier(key) || globalsLeftOut.has(key) || neverRead.test(key)) continue;
    const kind = "a global " + typeof (globalThis as any)[key];
    families.globals.push({
      read: key,
      base: "globalThis",
      key: JSON.stringify(key),
      kind,
      throws: false,
      isOfPrimitive: false,
      isBinding: true,
    });
    families.globals.push({
      read: "globalThis." + key,
      base: "globalThis",
      key: JSON.stringify(key),
      kind: kind + " by globalThis",
      throws: false,
      isOfPrimitive: false,
      isBinding: false,
    });
    walk(families.globals, [globalThis], key, (globalThis as any)[key], 0);
  }
  (family === "instances" ? instances : []).forEach((text, index) => {
    const value = (0, eval)(`"use strict"; (${text})`);
    walk(
      families.instances,
      [],
      "made" + index,
      Object(value),
      deepest,
      `const made${index} = ${text};`,
      Object(value) !== value,
    );
  });
  const isOfModules = (formsOfBinding as readonly string[]).includes(family);
  const modules = [
    ...new Set([
      ...builtinModules.map(name => (name.includes(":") ? name : "node:" + name)),
      "bun:ffi",
      "bun:jsc",
      "bun:sqlite",
    ]),
  ]
    .filter(name => isOfModules && !modulesLeftOut.test(name))
    .sort();
  const walked = modules.map((name, number) =>
    Bun.spawn({
      cmd: [process.execPath, import.meta.path, "--module", name, String(number)],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    }),
  );
  for (const child of walked) {
    const text = await child.stdout.text();
    if (text)
      for (const [form, members] of Object.entries(JSON.parse(text) as Record<string, Member[]>))
        families[form].push(...members);
  }
  // The parts are cut between modules: a good half of what a program costs to build is the library code behind the modules that it loads.
  const moduleOf = (member: Member) => /"([^"]+)"\)?;$/.exec(member.setup ?? "")?.[1] ?? "";
  const taken = takeSomeOfEachKind(families[family], 3).sort((one, other) =>
    moduleOf(one) < moduleOf(other) ? -1 : Number(moduleOf(one) > moduleOf(other)),
  );
  const inPart = Math.ceil(taken.length / partsOfFamily);
  console.log(
    JSON.stringify({
      members: families[family].length,
      programs: Array.from({ length: partsOfFamily }, (_, part) =>
        writeProgram(taken.slice(part * inPart, (part + 1) * inPart)),
      ),
    }),
  );
  process.exit(0);
}
