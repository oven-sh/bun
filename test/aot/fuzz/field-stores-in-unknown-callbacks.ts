// An object with a declared or initialized field reaches a callback whose parameter the compiler knows nothing about,
// and the callback stores a built-in object, a library module or a loader into the field. The program then reads the
// field through the variable that the compiler does know: as a string, in arithmetic, with typeof, ===, Object.hasOwn
// and Object.keys.
import type { Random } from "./random";

/**
 * Declarations, and an expression that creates the object. `path` leads from the object to the holder of field `b`.
 * `TYPE` is the field's annotation in TypeScript: `type`, or `any`.
 */
const objects: { declares: string; make: string; path?: string; type?: string }[] = [
  { declares: "class C# {\n  bTYPE;\n}", make: "new C#()", type: "?: number" },
  { declares: "class C# {\n  bTYPE = 1;\n}", make: "new C#()", type: "" },
  { declares: 'class C# {\n  bTYPE = "x";\n}', make: "new C#()", type: "" },
  { declares: "class C# {\n  bTYPE = null;\n  c = 2;\n}", make: "new C#()", type: ": number | null" },
  {
    declares: "class C# {\n  bTYPE;\n  constructor() {\n    this.b = 1.5;\n  }\n}",
    make: "new C#()",
    type: ": number",
  },
  { declares: "class B# {\n  bTYPE = 1;\n}\nclass C# extends B# {\n  c = 2;\n}", make: "new C#()", type: "" },
  { declares: "function C#(THIS) {\n  this.b = undefined;\n}", make: "new (C#NEWABLE)()" },
  { declares: "", make: "{ b: 1 }" },
  { declares: "", make: '{ a: "a", b: undefined }' },
  { declares: "", make: "{ inner: { b: null } }", path: ".inner" },
  { declares: "", make: "{ inner: { b: 1, c: [] } }", path: ".inner" },
  { declares: "", make: "[{ b: 1 }]", path: "[0]" },
];

/** What is stored. */
const values = [
  "Map",
  "Promise",
  "Date",
  "RegExp",
  "Error",
  "Uint8Array",
  "JSON",
  "Math",
  "globalThis",
  "Reflect",
  "Intl",
  "process",
  "console",
  "Bun",
  "fs",
  "EventEmitter.prototype",
  "EventEmitter",
  "loader",
  "process.getBuiltinModule",
  "Map.prototype",
  "Array.prototype.push",
  "new Map()",
  "Promise.resolve(1)",
  "new Date(0)",
  "/x/g",
  "new Uint8Array(2)",
  // These were always handled like ordinary objects.
  "Set",
  "WeakMap",
  "Symbol",
  "Object",
  "Function",
  "ArrayBuffer",
  "Proxy",
  "{ plain: 1 }",
];

/** `T` is the holder of the field as the callback sees it, `X` the value. */
const stores = [
  "T.b = X;",
  'Reflect.set(T, "b", X);',
  "({ b: T.b } = { b: X });",
  "T.b ??= X;",
  'T["b"] = X;',
  "Object.assign(T, { b: X });",
  'Object.defineProperty(T, "b", { value: X, writable: true, enumerable: true, configurable: true });',
  "[T.b] = [X];",
];

/**
 * Calls that pass `made` to the function `STORE(value)` in a way the compiler does not follow. Each is a statement.
 */
const routes = [
  'JSON.stringify({ made }, function (KEY, VALUE) {\n  if (key !== "made") return value;\n  STORE(value);\n  return 1;\n});',
  "[made].forEach(value => STORE(value));",
  "new Map([[1, made]]).forEach(value => STORE(value));",
  "Reflect.apply(STORE, undefined, [made]);",
  "STORE.call(undefined, made);",
  "[made].sort().map(STORE);",
  "Array.from([made], value => STORE(value));",
  "hidden(STORE)(made);",
  'emitter.once("made", STORE).emit("made", made);',
  "structuredClone({ n: 1 }), Object.values({ made }).forEach(STORE);",
  'JSON.parse("[0]", () => STORE(made));',
  '"x".replace("x", () => (STORE(made), ""));',
];

/**
 * Expressions over `R`, the field read through the known variable, `H`, its holder, and `X`, the stored value. `A` is
 * the field again, cast to `any` in TypeScript, where the checker would reject the expression for some declared type.
 */
const reads = [
  "typeof R",
  "R === X",
  'Object.hasOwn(H, "b")',
  "Object.keys(H).join()",
  // A library function's source text is not in an executable, so a function's text is cut at its parameters.
  'attempt(() => `${R}`.replace(/\\(.*/s, "").slice(0, 24))',
  "attempt(() => String(A * 2))",
  'attempt(() => String(A + 1).replace(/\\(.*/s, "").slice(0, 24))',
  "R == null",
  "Boolean(R)",
  "Object.prototype.toString.call(R)",
  "attempt(() => typeof A.constructor)",
  "A instanceof Object",
  "attempt(() => typeof JSON.stringify(H))",
  "attempt(() => String(A?.name))",
  "attempt(() => `${typeof A.get} ${typeof A.then} ${typeof A.readFileSync}`)",
];

export function generate(random: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const scenes: string[] = [];
  // A store of an ordinary value through an unknown receiver tells the compiler that a field of that name may hold
  // anything. So most programs have one scene, and each scene has its own field name.
  for (let scene = 0, count = random.pick([1, 1, 1, 2, 4]); scene < count; scene++) {
    // Make the random choices first.
    const object = random.pick(objects);
    const value = random.pick(values);
    // A fresh object is not equal to the one that was stored.
    const isStable = !/^(new |Promise\.resolve|\/|\{)/.test(value);
    const path = object.path ?? "";
    const isInFunction = random.chance(0.7);
    // In TypeScript the field and the variable have their natural types, or both are `any`.
    const isDeclared = typed && random.chance(0.6);
    const field = `made${path}.b`;
    const repeats = random.pick([1, 1, 3, 200]);
    const chosen = random.sample(reads, random.between(3, 7)).filter(read => isStable || !read.includes("X"));
    const told = (when: string) =>
      `console.log("${scene} ${when}", ${chosen
        .map(read =>
          read
            .replaceAll("R", field)
            .replaceAll("A", typed ? `(${field} as any)` : field)
            .replaceAll("H", `made${path}`)
            .replaceAll("X", typed ? `(${value} as any)` : value),
        )
        .join(", ")});`;
    // The first route has found the most.
    const route = (random.chance(0.4) ? routes[0] : random.pick(routes))
      .replaceAll("STORE", `store${scene}`)
      .replace("KEY", "key" + (typed ? ": string" : ""))
      .replace("VALUE", "value" + any);
    const body = [
      `const made${isDeclared ? "" : any} = ${object.make.replaceAll("#", String(scene)).replace("NEWABLE", typed ? " as any" : "")};`,
      random.chance(0.5) ? told("before") : "",
      repeats === 1 ? route : `for (let i = 0; i < ${repeats}; i++) {\n${route}\n}`,
      told("after"),
      random.chance(0.3) ? `${typed ? `(${field} as any)` : field} = 7;\n${told("stored again")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    scenes.push(
      [
        object.declares
          .replaceAll("#", String(scene))
          .replaceAll("TYPE", isDeclared ? object.type! : any)
          .replace("THIS", typed ? "this: any" : ""),
        `function store${scene}(value${any}) {\n${random
          .pick(stores)
          .replaceAll("T", `value${path}`)
          .replaceAll("X", value)}\n}`,
        isInFunction ? `function scene${scene}() {\n${body}\n}\nscene${scene}();` : `{\n${body}\n}`,
      ]
        .filter(Boolean)
        .join("\n")
        .replace(/\bb\b/g, `b${scene}`),
    );
  }
  // A module loader or a library module in the program makes the compiler assume less, so each is only there if a scene
  // uses it.
  const text = scenes.join("\n");
  const uses = (name: string) => new RegExp(`\\b${name}\\b`).test(text);
  const prelude = [
    (uses("EventEmitter") || uses("emitter")) && 'import { EventEmitter } from "node:events";',
    uses("fs") && 'import fs from "node:fs";',
    uses("loader") && 'import { createRequire } from "node:module";\nconst loader = createRequire(import.meta.url);',
    uses("emitter") && "const emitter = new EventEmitter();",
    uses("hidden") && `const hidden = ${typed ? "<F,>(f: F): F" : "f"} => [f, f][Date.now() > 0 ? 0 : 1];`,
  ].filter(Boolean);
  return `${prelude.join("\n")}
function attempt(run${typed ? ": () => unknown" : ""}) {
  try {
    return run();
  } catch (error) {
    return "threw " + (error${typed ? " as Error" : ""}).name;
  }
}
${text}
`;
}
