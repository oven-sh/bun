// Programs that declare names of their own which are also the names of built-ins: `Math`, `JSON`, `Object`, `Array`, `Promise`, `console`, `process`, `undefined` and forty more.
// Inside the declaration's scope the name means what the program declared; outside of it, ahead of it and behind it, it means the built-in.
//
//   declared    `const`, `let`, `var`, a function, a class, a parameter, a parameter in a pattern, a default, `catch`, the heads of `for`, `for .. of` and `for .. in`, the own name of a function
//               expression and of a class expression, an import by name, under another name, as a namespace and as the default; a label, which declares nothing
//   where       a block, a function, an arrow, a method, the whole file; read in the same scope, in closures, in callbacks of array methods, ahead of the declaration
//   holds       something of the program's that tells of every read, call and `new`; the built-in itself; now one, now the other; nothing
//   used        as the compiler knows the built-in best: `Math.max(..)`, `JSON.stringify(..)`, `Object.keys(..)`, `Array.isArray(..)`, `String(..)`, `new Map()`, `x === undefined`, `console.log(..)` ..
import type { Random } from "./random";

const uses: Record<string, string[]> = {
  Math: [
    "Math.max(1, 2)",
    "Math.floor(1.5)",
    "Math.PI",
    "Math.abs(-1)",
    "Math.min()",
    "Math.imul(3, 4)",
    "Math.sqrt(4)",
  ],
  JSON: ["JSON.stringify({ a: 1 })", 'JSON.parse("[1]")', "JSON.stringify(undefined)"],
  Object: [
    "Object.keys({ a: 1 })",
    "Object.assign({}, { a: 1 })",
    "Object.freeze([1])",
    "Object.create(null)",
    "new Object()",
    "Object(1)",
    "Object.entries({ a: 1 })",
    "Object.is(0, -0)",
    "({}) instanceof Object",
  ],
  Array: ["Array.isArray([])", 'Array.from("ab")', "new Array(3)", "Array(2)", "Array.of(1)", "[] instanceof Array"],
  String: ["String(1)", "String.fromCharCode(65)", "String.raw`a${1}`", 'new String("a")', "String(Symbol.iterator)"],
  Number: [
    'Number("1")',
    "Number.isInteger(1)",
    "Number.MAX_SAFE_INTEGER",
    'Number.parseFloat("1.5")',
    "Number.isNaN(NaN)",
  ],
  Boolean: ["Boolean(0)", "[0, 1].filter(Boolean)", "new Boolean(false)"],
  BigInt: ["BigInt(1)", "BigInt.asUintN(8, 257n)"],
  Symbol: ['Symbol("x").description', "Symbol.iterator", 'Symbol.for("y")', "typeof Symbol()"],
  Promise: ["Promise.resolve(1)", "new Promise(() => {})", "Promise.all([])", "Promise.resolve(1) instanceof Promise"],
  Map: ["new Map([[1, 2]]).size", "new Map() instanceof Map", "Map.name"],
  Set: ["new Set([1, 1]).size", "Set.name"],
  WeakMap: ["new WeakMap() instanceof WeakMap"],
  Date: ["new Date(0).getTime()", "typeof Date.now()", "Date.UTC(1970, 0)"],
  RegExp: ['new RegExp("a").test("a")', "/a/ instanceof RegExp", 'RegExp("a", "g").flags'],
  Error: ['new Error("x").message', "new TypeError() instanceof Error", 'Error("y").message', "Error.name"],
  TypeError: [
    'new TypeError("x").name',
    "(() => {\ntry {\nnull.x;\n} catch (error) {\nreturn error instanceof TypeError;\n}\n})()",
  ],
  Reflect: ["Reflect.ownKeys({ a: 1 })", 'Reflect.has({ a: 1 }, "a")', "Reflect.apply(Math.max, null, [1, 2])"],
  Proxy: ["typeof new Proxy({}, {})", "Proxy.length"],
  Function: ['new Function("return 1")()', "(() => {}) instanceof Function", "Function.prototype.call.length"],
  parseInt: ['parseInt("12px")', '["1", "2", "3"].map(parseInt)'],
  parseFloat: ['parseFloat("1.5x")'],
  isNaN: ['isNaN("x")', "isNaN(1)"],
  isFinite: ["isFinite(1 / 0)"],
  undefined: [
    "undefined",
    "void 0 === undefined",
    "typeof undefined",
    "[undefined].length",
    "((given = 5) => given)(undefined)",
    "({ a: undefined }).a ?? 1",
  ],
  NaN: ["NaN", "NaN === NaN", "typeof NaN", 'Object.is(NaN, Number("x"))'],
  Infinity: ["Infinity", "-Infinity", "1 / 0 === Infinity"],
  globalThis: ["typeof globalThis", "globalThis.Math === Math", "typeof globalThis.Array"],
  console: ['console.log("printed by console.log")', "typeof console.error"],
  process: ["typeof process.argv", "typeof process.nextTick", "process.exitCode", "typeof process.env"],
  Bun: ["typeof Bun.version", "typeof Bun.file", "Bun.inspect(1)"],
  Buffer: ['Buffer.from("a").length', "Buffer.isBuffer(1)", "Buffer.alloc(2).length"],
  URL: ['new URL("http://a/b").pathname', 'URL.canParse("x")'],
  TextEncoder: ['new TextEncoder().encode("a").length'],
  Uint8Array: ["new Uint8Array(2).length", "Uint8Array.BYTES_PER_ELEMENT", "Uint8Array.from([1]).length"],
  ArrayBuffer: ["new ArrayBuffer(2).byteLength", "ArrayBuffer.isView(1)"],
  structuredClone: ["structuredClone({ a: 1 })"],
  queueMicrotask: ["queueMicrotask(() => {})"],
  setTimeout: ["typeof setTimeout(() => {}, 0)"],
  Intl: ["typeof Intl.NumberFormat"],
  WeakRef: ["typeof new WeakRef({}).deref()"],
  Iterator: ["typeof Iterator.from([1]).next"],
  require: ['typeof require("node:path").join'],
};

const head = `const lines = [];
const world = globalThis;
const print = globalThis.console.log.bind(globalThis.console);
function show(value, depth = 0) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "string") return '"' + value + '"';
  if (typeof value === "bigint") return value + "n";
  if (value === null || typeof value !== "object") return 1 / value === -1 / 0 ? "-0" : "" + value;
  if (depth > 2) return "..";
  const kind = globalThis.Object.prototype.toString.call(value).slice(8, -1);
  return kind + "{" + globalThis.Reflect.ownKeys(value).map(key => key.toString() + ":" + show(value[key], depth + 1)).join(",") + "}";
}
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
`;
const fake = `function own(name) {
  return new globalThis.Proxy(function own() {}, {
    get(target, key) {
      if (key === globalThis.Symbol.toPrimitive) return () => "own " + name;
      if (key === globalThis.Symbol.hasInstance) return () => "own";
      if (key === "then" || key === "prototype") return void 0;
      return (...given) => "own " + name + "." + key.toString() + "/" + given.length;
    },
    apply(target, receiver, given) {
      return "own " + name + "()/" + given.length;
    },
    construct(target, given) {
      return { made: "by own " + name, given: given.length };
    },
  });
}
`;

export function generate(random: Random): { text: string; files: Record<string, string> } {
  const names = Object.keys(uses);
  const files: Record<string, string> = { "own.js": `export ${fake}` };
  const rows: string[] = [];
  let count = 0;

  /** Lines that use the name in the ways the compiler knows best. */
  const reads = (name: string, where: string): string =>
    random
      .sample(uses[name], random.between(1, 3))
      .map(use => {
        const wrapped = random.weighted([
          [5, use],
          [1, `(() => ${use.startsWith("{") ? `(${use})` : use})()`],
          [1, `[0].map(() => ${use})[0]`],
        ]);
        return `attempt(${JSON.stringify(`${where}: ${use.split("\n")[0]}`)}, () => ${wrapped});`;
      })
      .join("\n");

  for (let id = 0, scenes = random.between(5, 11); id < scenes; id++) {
    const name = random.pick(names.filter(each => each !== "require"));
    const holds = random.weighted([
      [6, `own("${name}")`],
      [1, `world.${name}`],
      [1, `(${id} % 2 ? own("${name}") : world.${name})`],
      [1, "void 0"],
      [1, "null"],
      [
        1,
        `{ max: () => "a member of a literal", keys: () => "a member of a literal", log: () => "a member of a literal" }`,
      ],
    ]);
    const inside = () => reads(name, "inside");
    const isWord = name === "undefined" || name === "NaN" || name === "Infinity";
    rows.push(
      `note("scene ${id}: ${name}");`,
      reads(name, "ahead"),
      random.weighted<() => string>([
        [4, () => `{\n${random.pick(["const", "let"])} ${name} = ${holds};\n${inside()}\n}`],
        [2, () => `{\nconst early = () => {\n${inside()}\n};\nearly();\nlet ${name} = ${holds};\nearly();\n}`],
        [3, () => `(function () {\n${inside()}\nvar ${name} = ${holds};\n${inside()}\n})();`],
        [4, () => `(function (${name}) {\n${inside()}\n})(${holds});`],
        [2, () => `((${name}) => {\n${inside()}\n})(${holds});`],
        [2, () => `(function ({ ${name} }, [second]) {\n${inside()}\n})({ ${name}: ${holds} }, []);`],
        [2, () => `(function (${name} = ${holds}) {\n${inside()}\n})();`],
        [2, () => `try {\nthrow ${holds};\n} catch (${name}) {\n${inside()}\n}`],
        [
          isWord ? 0 : 2,
          () =>
            `{\n${inside()}\nfunction ${name}(...given) {\nreturn "a function of the program/" + given.length;\n}\n${inside()}\n}`,
        ],
        [
          isWord ? 0 : 2,
          () =>
            `{\nclass ${name} {\nstatic max() {\nreturn "a static method of the program";\n}\nstatic keys() {\nreturn "a static method of the program";\n}\nstatic isArray() {\nreturn "a static method of the program";\n}\nstatic stringify() {\nreturn "a static method of the program";\n}\n}\n${inside()}\n}`,
        ],
        [2, () => `for (const ${name} of [${holds}, ${holds}]) {\n${inside()}\n}`],
        [1, () => `for (let ${name} = ${holds}, turn = 0; turn < 1; turn++) {\n${inside()}\n}`],
        [1, () => `for (const ${name} in { key: 1 }) {\n${inside()}\n}`],
        [
          isWord ? 0 : 1,
          () =>
            `{\nlet entered = 0;\n(function ${name}() {\nif (entered++) return "entered again";\n${inside()}\n})();\n}`,
        ],
        [
          isWord ? 0 : 1,
          () =>
            `{\nlet entered = 0;\nnew (class ${name} {\nconstructor() {\nif (entered++) return;\n${inside()}\n}\n})();\n}`,
        ],
        [1, () => `${name}: {\n${inside()}\nbreak ${name};\n}`],
        [2, () => `({\nrun(${name}) {\nreturn [1].forEach(() => {\n${inside()}\n});\n},\n}).run(${holds});`],
        [2, () => `{\nlet ${name} = world.${name};\n${inside()}\n${name} = ${holds};\n${inside()}\n}`],
        [
          1,
          () =>
            `(function () {\nconst held = { ${name}: ${holds} };\nconst { ${name} } = held;\n${inside()}\nreturn { ${name} };\n})();`,
        ],
      ])(),
      reads(name, "behind"),
    );
  }

  // Files in which an import gives the name its meaning, for the whole file.
  for (let id = 0, more = random.between(1, 3); id < more; id++) {
    const name = random.pick(
      names.filter(each => !["undefined", "NaN", "Infinity", "require", "globalThis"].includes(each)),
    );
    const file = `whole${count++}.js`;
    const form = random.pick([
      `import { ${name} } from "./gives-${name}.js";`,
      `import { other as ${name} } from "./gives-${name}.js";`,
      `import ${name} from "./gives-${name}.js";`,
      `import * as ${name} from "./gives-${name}.js";`,
    ]);
    files[`gives-${name}.js`] =
      `import { own } from "./own.js";\nexport const ${name} = own("${name}");\nexport const other = own("another ${name}");\nexport default own("the default ${name}");\nexport const max = () => "an export named max";\nexport const keys = () => "an export named keys";\nexport const log = () => "an export named log";\nexport const stringify = () => "an export named stringify";\n`;
    files[file] =
      `${form}\nexport function run(attempt) {\n${reads(name, `in ${file}`)}\nreturn [0].map(() => typeof ${name})[0];\n}\n`;
    rows.push(`note("${file}: ${name}", (await import("./${file}")).run(attempt));`, reads(name, "in the first file"));
  }
  return { text: `import { own } from "./own.js";\n${head}${rows.join("\n")}\nprint(lines.join("\\n"));\n`, files };
}
