// Small programs about one thing that has two names. It is read under one name, stored to under the other, and read again under the first, all in one function: the second read sees the store. The
// second name comes by one road. There is one scene, no helper, and every line is printed at once, by `console.log` itself.
//
//   the thing    a literal, an instance of a class, a list, made in the function or handed in; a buffer; a `Map`; a pattern and its `lastIndex`; a date; a variable of a module; `module.exports`; a
//                member of `globalThis`; the environment of the process; a function and its members; a parameter
//   the road     what `Object.assign`, `Object.defineProperty`, `Object.seal`, `Object.setPrototypeOf`, `Object(..)`, `valueOf` answer; a getter or a method that answers `this`; a proxy and its
//                target; an object and the one above it; two parameters; `this` and a parameter; a default that names another parameter; what comes back out of a list, a literal, a `Map`, a
//                closure, a `catch`, a loop, a generator, a constructor, a `WeakRef`; two views of one buffer, a part of a view, a `DataView`, a `Buffer`; a namespace and an imported name;
//                `exports`, `module.exports` and `this`; a bare name and `globalThis`; `arguments` and a parameter; a name in brackets and behind a dot; `length` and the elements
//   the store    `=`, `++`, `+=`, `delete`, patterns, `Object.assign`, `Object.defineProperty` with a value or a getter, `Reflect.set`, a key in brackets; values of other kinds
//   the reads    in two statements, in one call, in one sum, in a test that is asked again, in the test of a loop, in two turns of a loop, under `typeof`
import type { Random } from "./random";

type Pair = {
  setup: string;
  read: string;
  stores: string[];
  parameters?: string;
  given?: string;
  outside?: string;
  receiver?: string;
  needs?: "is not strict" | "a module" | "is not a module";
  files?: Record<string, string>;
  imports?: string;
};

export function generate(random: Random): { file: string; text: string; files?: Record<string, string> } {
  const value = () => random.pick(["2", "2", "2", '"t"', "1.5", "null", "undefined", "-0", "2 ** 31", "true", "[7]"]);
  const shape = random.pick(["literal", "literal", "wide", "instance", "list"] as const);
  const M = shape === "list" ? "[0]" : ".x";
  const K = shape === "list" ? "0" : '"x"';
  const N = shape === "list" ? "0" : "x";
  const made = {
    literal: "{ x: 1 }",
    wide: '{ w: "w", x: 1, y: 2.5 }',
    instance: "new Thing()",
    list: "[1, 2]",
  }[shape];
  const thing =
    shape === "instance" ? "class Thing {\nx = 1;\nget self() {\nreturn this;\n}\nme() {\nreturn this;\n}\n}" : "";
  const memberStores = (b: string) => [
    `${b}${M} = ${value()}`,
    `${b}${M} = ${value()}`,
    `${b}${M} = ${value()}`,
    `${b}[${K}] = ${value()}`,
    `${b}[[${K}][0]] = ${value()}`,
    `${b}${M}++`,
    `${b}${M} += 1`,
    `delete ${b}${M}`,
    `Object.assign(${b}, { ${N}: ${value()} })`,
    `Object.defineProperty(${b}, ${K}, { value: ${value()} })`,
    `Object.defineProperty(${b}, ${K}, { get: () => 3 })`,
    `Reflect.set(${b}, ${K}, ${value()})`,
    `({ k: ${b}${M} } = { k: ${value()} })`,
    `[${b}${M}] = [${value()}]`,
    `${b}${M} &&= ${value()}`,
  ];

  // Roads on which a second name for `a` is reached.
  const answers: [number, string][] = [
    [3, "Object.assign(a, {})"],
    [1, "Object.assign(a)"],
    [2, 'Object.defineProperty(a, "z", { value: 0 })'],
    [1, "Object.seal(a)"],
    [1, "Object.preventExtensions(a)"],
    [1, "Object.setPrototypeOf(a, Object.getPrototypeOf(a))"],
    [2, "Object(a)"],
    [1, "new Object(a)"],
    [2, "a.valueOf()"],
    [3, "new Proxy(a, {})"],
    [2, "[a][0]"],
    [1, "[a].at(0)"],
    [1, "[a].pop()"],
    [1, "[a].find(Boolean)"],
    [1, "[0].map(() => a)[0]"],
    [1, "[a].slice()[0]"],
    [1, "[...[a]][0]"],
    [1, "{ a }.a"],
    [1, "{ ...{ a } }.a"],
    [1, "Object.values({ a })[0]"],
    [1, 'Reflect.get({ a }, "a")'],
    [1, "new Map([[1, a]]).get(1)"],
    [1, "[...new Set([a])][0]"],
    [2, "(() => a)()"],
    [1, "(given => given)(a)"],
    [1, "(function () {\nreturn this;\n}).call(a)"],
    [1, "(function () {\nreturn arguments[0];\n})(a)"],
    [1, "((...all) => all[0])(a)"],
    [1, "new (class {\nconstructor() {\nreturn a;\n}\n})()"],
    [1, "new WeakRef(a).deref()"],
    [1, "(function* () {\nyield a;\n})().next().value"],
    [1, "(null ?? a)"],
    [1, "(a || null)"],
    [1, "(0, a)"],
    ...(shape === "instance"
      ? ([
          [4, "a.self"],
          [3, "a.me()"],
          [1, 'a["self"]'],
        ] as [number, string][])
      : []),
  ];
  const isHandedIn = random.chance(0.35);
  const born = isHandedIn ? "" : `const a = ${made};\n`;
  const handed = isHandedIn ? { parameters: "a", given: made } : {};
  const swaps = random.chance(0.4);
  const two = (a: string, b: string) =>
    swaps ? { read: `${b}${M}`, stores: memberStores(a) } : { read: `${a}${M}`, stores: memberStores(b) };

  const pairs: [number, () => Pair][] = [
    [
      20,
      () => {
        const answer = random.weighted(answers);
        return {
          setup: `${born}const b = ${answer.startsWith("{") ? `(${answer})` : answer};`,
          ...two("a", "b"),
          ...handed,
        };
      },
    ],
    [
      5,
      () => ({ setup: "", parameters: "a, b", given: "one, one", outside: `const one = ${made};`, ...two("a", "b") }),
    ],
    [2, () => ({ setup: "", parameters: "a, b = a", given: made, ...two("a", "b") })],
    [
      2,
      () => ({
        setup: "",
        parameters: "a, { b }",
        given: "one, { b: one }",
        outside: `const one = ${made};`,
        ...two("a", "b"),
      }),
    ],
    [
      2,
      () => ({
        setup: "",
        parameters: "a, ...[b]",
        given: "one, one",
        outside: `const one = ${made};`,
        ...two("a", "b"),
      }),
    ],
    [
      3,
      () => ({
        setup: "",
        parameters: "a",
        given: "one",
        receiver: "one",
        outside: `const one = ${made};`,
        ...two("a", "this"),
      }),
    ],
    [
      2,
      () => ({
        setup: `${born}let b;\ntry {\nthrow a;\n} catch (caught) {\nb = caught;\n}`,
        ...two("a", "b"),
        ...handed,
      }),
    ],
    [2, () => ({ setup: `${born}let b;\nfor (const each of [a]) b = each;`, ...two("a", "b"), ...handed })],
    [2, () => ({ setup: `${born}const [b] = [a];`, ...two("a", "b"), ...handed })],
    [2, () => ({ setup: `${born}const { b } = { b: a };`, ...two("a", "b"), ...handed })],
    [2, () => ({ setup: `${born}const holder = { inner: a };`, ...two("a", "holder.inner"), ...handed })],
    [
      2,
      () => ({
        setup: `${born}const holder = { inner: a };\nconst b = holder.inner;`,
        ...two("holder.inner", "b"),
        ...handed,
      }),
    ],
    // The object above: a read below sees a store above, until the one below has a member of its own.
    [3, () => ({ setup: `${born}const b = Object.create(a);`, read: `b${M}`, stores: memberStores("a"), ...handed })],
    [2, () => ({ setup: `${born}const b = { __proto__: a };`, read: `b${M}`, stores: memberStores("a"), ...handed })],
    [2, () => ({ setup: `${born}const b = Object.create(a);`, read: `a${M}`, stores: memberStores("b"), ...handed })],
    [
      3,
      () => ({
        outside: "class Kind {}\nKind.prototype.x = 1;",
        setup: "const o = new Kind();",
        read: "o.x",
        stores: [
          `Kind.prototype.x = ${value()}`,
          `Object.getPrototypeOf(o).x = ${value()}`,
          `o.constructor.prototype.x = ${value()}`,
          `o.__proto__.x = ${value()}`,
          "delete Kind.prototype.x",
          `Object.defineProperty(Kind.prototype, "x", { get: () => 3 })`,
        ],
      }),
    ],
    [
      2,
      () => ({
        outside: "class Kind {\nstatic x = 1;\n}",
        setup: "const o = new Kind();",
        read: random.pick(["Kind.x", "o.constructor.x"]),
        stores: [
          `o.constructor.x = ${value()}`,
          `Kind.x = ${value()}`,
          `Kind["x"] = ${value()}`,
          "delete o.constructor.x",
        ],
      }),
    ],
    // A name in brackets and behind a dot; `length` and the elements.
    [
      2,
      () => ({
        setup: `const a = { x: 1 };\nconst key = ["x"][0];`,
        read: "a.x",
        stores: [`a[key] = ${value()}`, "a[key]++", "delete a[key]"],
      }),
    ],
    [
      2,
      () => ({
        setup: `const a = [1, 2];`,
        read: "a[0]",
        stores: [
          `a["0"] = ${value()}`,
          "a.length = 0",
          "a.shift()",
          "a.reverse()",
          "a.fill(5)",
          "a.unshift(9)",
          "a.sort((p, q) => q - p)",
          "a.copyWithin(0, 1)",
          "a.splice(0, 1)",
        ],
      }),
    ],
    [
      3,
      () => ({
        setup: `const a = [1, 2];`,
        read: "a.length",
        stores: [
          "a[5] = 1",
          "a.push(3)",
          "a.pop()",
          'a["2"] = 1',
          "a.splice(0, 1)",
          "Object.assign(a, { 4: 1 })",
          'Reflect.set(a, "length", 0)',
          "a[a.length] = 1",
          "[a[3]] = [1]",
        ],
      }),
    ],
    [
      1,
      () => ({
        setup: `const a = [1, 2];\nconst b = a;`,
        read: "a.at(-1)",
        stores: ["b.push(3)", "b.length = 1", "b.reverse()"],
      }),
    ],
    // Views of one buffer.
    [
      6,
      () => {
        const [first, second] = random.pick([
          ["new Uint32Array(buffer)", "new Uint8Array(buffer)"],
          ["new Uint8Array(buffer)", "new Uint32Array(buffer)"],
          ["new Float64Array(buffer)", "new Int32Array(buffer)"],
          ["new Int32Array(buffer)", "new Float64Array(buffer)"],
          ["new Int32Array(buffer)", "new Float32Array(buffer)"],
          ["new Uint8Array(buffer)", "new Uint8Array(buffer)"],
          ["new Uint8Array(buffer)", "new Int8Array(buffer)"],
          ["new Uint8Array(buffer)", "new Uint8ClampedArray(buffer)"],
          ["new Uint16Array(buffer)", "new Uint8Array(buffer, 1)"],
          ["new Uint8Array(buffer)", "Buffer.from(buffer)"],
          ["Buffer.from(buffer)", "new Uint8Array(buffer)"],
          ["new BigInt64Array(buffer)", "new Int32Array(buffer)"],
        ]);
        return {
          setup: `const buffer = new ArrayBuffer(16);\nconst a = ${first};\nconst b = ${second};`,
          read: "a[0]",
          stores: [
            "b[0] = 7",
            "b[0] = 7",
            "b[0] = -1",
            "b[1] = 1",
            "b[0]++",
            "b.fill(3)",
            "b.set([9])",
            "b[0] = 1.5",
            "b.reverse()",
          ],
        };
      },
    ],
    [
      2,
      () => ({
        setup: "const a = new Uint8Array(8);\nconst b = a.subarray(0, 4);",
        read: "a[0]",
        stores: ["b[0] = 7", "b.fill(3)", "b.set([9])", "b[0]--"],
      }),
    ],
    [
      1,
      () => ({
        setup: "const a = new Uint8Array(8);\nconst b = a.subarray(2);",
        read: "a[2]",
        stores: ["b[0] = 7", "b.fill(3)"],
      }),
    ],
    [
      1,
      () => ({
        setup: "const a = new Uint8Array(8);\nconst b = new Uint8Array(a.buffer);",
        read: "a[0]",
        stores: ["b[0] = 7", "b.fill(3)"],
      }),
    ],
    [
      1,
      () => ({
        setup: "const a = Buffer.alloc(8);\nconst b = a.slice(0, 4);",
        read: "a[0]",
        stores: ["b[0] = 7", "b.fill(3)", "b.writeUInt8(5, 0)", 'b.write("z")'],
      }),
    ],
    [
      2,
      () => ({
        setup: "const a = new Uint32Array(4);\nconst b = new DataView(a.buffer);",
        read: "a[0]",
        stores: ["b.setUint8(0, 7)", "b.setUint32(0, 7, true)", "b.setFloat32(0, 1.5, true)", "b.setInt16(0, -1)"],
      }),
    ],
    [
      1,
      () => ({
        setup: "const b = new Uint32Array(4);\nconst a = new DataView(b.buffer);",
        read: "a.getUint8(0)",
        stores: ["b[0] = 7", "b.fill(258)"],
      }),
    ],
    [
      2,
      () => ({
        setup: "const buffer = new ArrayBuffer(8, { maxByteLength: 16 });\nconst a = new Uint8Array(buffer);",
        read: "a.length",
        stores: ["buffer.resize(16)", "buffer.resize(0)", "buffer.transfer()"],
      }),
    ],
    [
      1,
      () => ({
        setup: "const buffer = new ArrayBuffer(8);\nconst a = new Uint8Array(buffer).fill(1);",
        read: random.pick(["a[0]", "a.length", "a.byteLength"]),
        stores: ["buffer.transfer()", "structuredClone(buffer, { transfer: [buffer] })"],
      }),
    ],
    // Built-in objects with a state.
    [
      2,
      () => ({
        setup: "const a = new Map([[1, 1]]);\nconst b = Object(a);",
        read: random.pick(["a.get(1)", "a.size", "a.has(1)"]),
        stores: ["b.set(1, 2)", "b.delete(1)", "b.clear()", "b.set(2, 2)"],
      }),
    ],
    [
      1,
      () => ({
        setup: "const a = new Set([1]);\nconst b = [a][0];",
        read: random.pick(["a.size", "a.has(1)"]),
        stores: ["b.add(2)", "b.delete(1)", "b.clear()"],
      }),
    ],
    [
      2,
      () => ({
        setup: "const a = /x/g;\nconst b = [a][0];",
        read: "a.lastIndex",
        stores: ['b.exec("xx")', 'b.test("xx")', "b.lastIndex = 5", '"xx".replace(b, "")', '"xx".match(b)'],
      }),
    ],
    [
      1,
      () => ({
        setup: "const a = new Date(1);\nconst b = [a][0];",
        read: random.pick(["a.getTime()", "+a", "a.valueOf()"]),
        stores: ["b.setTime(2)", "b.setMilliseconds(5)", "b.setTime(NaN)"],
      }),
    ],
    // A getter in front of another object.
    [
      2,
      () => ({
        setup: "const hidden = { x: 1 };\nconst a = {\nget x() {\nreturn hidden.x;\n},\n};",
        read: "a.x",
        stores: [`hidden.x = ${value()}`, "hidden.x++", "delete hidden.x"],
      }),
    ],
    [
      2,
      () => ({
        setup: "let hidden = 1;\nconst a = {\nget x() {\nreturn hidden;\n},\n};",
        read: "a.x",
        stores: [`hidden = ${value()}`, "hidden++", `[hidden] = [${value()}]`],
      }),
    ],
    [
      2,
      () => ({
        setup: "let hidden = 1;\nconst read = () => hidden;",
        read: "read()",
        stores: [`hidden = ${value()}`, "hidden++"],
      }),
    ],
    [
      2,
      () => ({
        setup: "let hidden = 1;\nconst put = given => {\nhidden = given;\n};",
        read: "hidden",
        stores: [`put(${value()})`, `[${value()}].forEach(put)`, `put.call(null, ${value()})`],
      }),
    ],
    // Parameters and `arguments`.
    [
      3,
      () => ({
        setup: "",
        parameters: "p",
        given: "1",
        read: "p",
        stores: [
          `arguments[0] = ${value()}`,
          "arguments[0]++",
          `Object.assign(arguments, [${value()}])`,
          `Reflect.set(arguments, "0", ${value()})`,
          `[arguments[0]] = [${value()}]`,
        ],
        needs: "is not strict",
      }),
    ],
    [
      3,
      () => ({
        setup: "",
        parameters: "p",
        given: "1",
        read: "arguments[0]",
        stores: [`p = ${value()}`, "p++", `[p] = [${value()}]`, `(() => {\np = ${value()};\n})()`],
        needs: "is not strict",
      }),
    ],
    [
      1,
      () => ({
        setup: "const all = arguments;",
        parameters: "p",
        given: "1",
        read: "p",
        stores: [`all[0] = ${value()}`, "delete all[0]", "Object.freeze(all)"],
        needs: "is not strict",
      }),
    ],
    // A function and its members.
    [
      1,
      () => ({
        outside: "function counted() {}\ncounted.x = 1;",
        setup: "const b = [counted][0];",
        read: "counted.x",
        stores: [`b.x = ${value()}`, "b.x++", "delete b.x"],
      }),
    ],
    [
      1,
      () => ({
        setup: "scene.x ??= 1;",
        read: "scene.x",
        stores: [`arguments.callee.x = ${value()}`, "arguments.callee.x++"],
        needs: "is not strict",
      }),
    ],
    // Names outside the file's own variables.
    [
      2,
      () => ({
        outside: "globalThis.shared = 1;",
        setup: "",
        read: "shared",
        stores: [
          `globalThis.shared = ${value()}`,
          "globalThis.shared++",
          `Reflect.set(globalThis, "shared", ${value()})`,
          `Object.assign(globalThis, { shared: ${value()} })`,
          `globalThis["shared"] = ${value()}`,
        ],
      }),
    ],
    [
      2,
      () => ({
        outside: "globalThis.shared = 1;",
        setup: "",
        read: "globalThis.shared",
        stores: [`shared = ${value()}`, "shared++", `[shared] = [${value()}]`],
      }),
    ],
    [
      1,
      () => ({
        outside: 'process.env.SHARED = "1";',
        setup: "",
        read: "Bun.env.SHARED",
        stores: ['process.env.SHARED = "2"', "delete process.env.SHARED"],
      }),
    ],
    [
      1,
      () => ({
        outside: 'process.env.SHARED = "1";',
        setup: "",
        read: "process.env.SHARED",
        stores: ['Bun.env.SHARED = "2"', "delete Bun.env.SHARED"],
      }),
    ],
    [
      3,
      () => ({
        outside: "exports.x = 1;",
        setup: "",
        read: random.pick(["exports.x", "module.exports.x"]),
        stores: [
          `module.exports.x = ${value()}`,
          `exports.x = ${value()}`,

          `require(__filename).x = ${value()}`,
          "delete module.exports.x",
        ],
        needs: "is not a module",
      }),
    ],
    [
      5,
      () => ({
        imports: random.pick([
          'import * as lib from "./lib.mjs";',
          'import * as lib from "./lib.mjs";\nimport { x } from "./lib.mjs";',
          'import { x, put, add } from "./lib.mjs";\nconst lib = { put, add };',
        ]),
        setup: "",
        read: "",
        stores: [`lib.put(${value()})`, `lib.put(${value()})`, "lib.add()", `[${value()}].forEach(lib.put)`],
        needs: "a module",
        files: {
          "lib.mjs":
            "export let x = 1;\nexport function put(given) {\nx = given;\n}\nexport function add() {\nx++;\n}\n",
        },
      }),
    ],
    [
      2,
      () => ({
        imports: 'import lib from "./lib.cjs";\nimport { createRequire } from "node:module";',
        setup: 'const again = createRequire(import.meta.url)("./lib.cjs");',
        read: "lib.x",
        stores: [`again.x = ${value()}`, "again.x++", "delete again.x", `again.put(${value()})`],
        needs: "a module",
        files: { "lib.cjs": "exports.x = 1;\nexports.put = function (given) {\nexports.x = given;\n};\n" },
      }),
    ],
  ];
  const pair = random.weighted(pairs)();
  if (pair.files?.["lib.mjs"])
    pair.read = pair.imports!.includes("{ x")
      ? pair.imports!.includes("* as")
        ? random.pick(["x", "lib.x"])
        : "x"
      : "lib.x";

  const R = pair.read;
  const store = random.pick(pair.stores);
  const statement = /^[({[]/.test(store) ? `;${store};`.slice(1) : `${store};`;
  const scene = random.weighted([
    [5, `const before = ${R};\n${statement}\nconsole.log(before, ${R});`],
    [3, `console.log(${R}, (${store}, 0), ${R});`],
    [3, `if (${R} === 1) {\n${statement}\nconsole.log(${R} === 1 ? "same" : "other", ${R});\n}`],
    [2, `let turns = 0;\nwhile (${R} === 1 && turns++ < 3) {\n${statement}\n}\nconsole.log(turns, ${R});`],
    [2, `const sum = ${R} + (${store}, 0) + ${R};\nconsole.log(sum);`],
    [2, `console.log(typeof ${R});\n${statement}\nconsole.log(typeof ${R});`],
    [2, `for (let turn = 0; turn < 2; turn++) {\nconsole.log(${R});\n${statement}\n}`],
    [2, `console.log(${R} + 1);\n${statement}\nconsole.log(${R} + 1);`],
    [2, `const first = ${R},\nsecond = (${store}, ${R});\nconsole.log(first, second, first === second);`],
    [1, `const all = [${R}, (${store}, 0), ${R}];\nconsole.log(all.join());`],
    [1, `console.log(\`\${${R}} \${(${store}, 0)} \${${R}}\`);`],
    [1, `const test = ${R} === 1;\n${statement}\nconsole.log(test, ${R} === 1, test === (${R} === 1));`],
    [1, `console.log(${R} ?? "none");\n${statement}\nconsole.log(${R} ?? "none");`],
  ]);

  const isModule =
    pair.needs === "a module" ||
    (pair.needs !== "is not strict" && pair.needs !== "is not a module" && random.chance(0.5));
  const file = isModule ? "main.mjs" : "main.cjs";
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error?.constructor.name);\n}`;
  const outside = [pair.imports, thing, pair.outside].filter(Boolean).join("\n");
  const body = [pair.setup, scene].filter(Boolean).join("\n");
  const needsAFunction = pair.parameters !== undefined || /\barguments\b|\bscene\b/.test(body);
  const place = needsAFunction
    ? random.pick(["once", "once", "thrice"] as const)
    : random.pick(["top", "top", "once", "once", "thrice"] as const);
  const text =
    place === "top"
      ? [outside, guarded(body)].filter(Boolean).join("\n")
      : [
          outside,
          `function scene(${pair.parameters ?? ""}) {\n${body}\n}`,
          guarded(
            Array(place === "once" ? 1 : 3)
              .fill(pair.receiver ? `scene.call(${pair.receiver}, ${pair.given});` : `scene(${pair.given ?? ""});`)
              .join("\n"),
          ),
        ]
          .filter(Boolean)
          .join("\n");
  return { file, text: text + "\n", files: pair.files };
}
