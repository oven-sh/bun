// Literals that make objects: lists, objects, patterns, functions, classes, templates. Each time the program comes by, a literal makes a new object, which knows nothing of what was done to the last one.
//
//   literals    lists of whole numbers, fractions, texts, holes, lists and objects; objects with names, indexes, getters and methods; regular expressions with and without `g` and `y`; arrows, functions,
//               classes with static fields; lists and objects that hold only constants, and ones that hold one value of the call
//   places      a function called again and again, a loop, a default of a parameter, a field of a class, a static field, a getter, a generator, a closure, an arrow that answers with the literal,
//               a function that is small enough to be copied into its callers, the top of a file that is imported twice
//   done to it  pushed to, popped, sorted, reversed, filled, stored into by index and by name, lengthened, shortened, frozen, sealed, given another prototype, deleted from, given a getter;
//               a regular expression is run, so that it remembers where it stopped, and compiled anew; a function and a class are given members
//   read        whether two are the same object, and what the next one looks like
import type { Random } from "./random";

const head = `const lines = [];
function show(value, depth = 0) {
  if (typeof value === "function") return "function{" + Object.keys(value).join() + "}";
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return Object.is(value, -0) ? "-0" : String(value);
  if (depth > 3) return "..";
  if (value instanceof RegExp) return String(value) + "@" + value.lastIndex + "{" + Object.keys(value).join() + "}";
  const flags = (Object.isFrozen(value) ? "frozen " : Object.isSealed(value) ? "sealed " : "") + (Object.getPrototypeOf(value) === null ? "bare " : "");
  if (Array.isArray(value)) return flags + "[" + Array.from(value, (each, at) => (at in value ? show(each, depth + 1) : "hole")).join(",") + "]" + Object.keys(value).filter(key => !/^\\d+$/.test(key)).join();
  return flags + "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show(Reflect.getOwnPropertyDescriptor(value, key).get ? "a getter" : value[key], depth + 1)).join(",") + "}";
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
const unknown = [value => value][0];
`;

export function generate(random: Random): string {
  const lists = [
    "[1, 2, 3]",
    "[]",
    "[1.5, 2.5]",
    '["a", "b"]',
    "[1, , 3]",
    "[[1], [2]]",
    "[{ a: 1 }]",
    '[1, "a", null]',
    "[0, 0, 0, 0, 0, 0, 0, 0, 0]",
    "[x]",
    "[1, x, 3]",
    "[undefined]",
    "[-0]",
    "[2 ** 31]",
    "[...[1, 2]]",
    "[true, false]",
  ];
  const objects = [
    "{}",
    "{ a: 1 }",
    "{ a: 1, b: 2 }",
    '{ a: "t", b: [1] }',
    "{ 0: 1, 1: 2 }",
    "{ a: { b: { c: 1 } } }",
    "{ a: x }",
    "{ get a() {\nreturn 1;\n} }",
    "{ m() {} }",
    "{ __proto__: null, a: 1 }",
    "{ a: 1.5 }",
    "{ a: undefined }",
    "{ a: [] }",
  ];
  const patterns = ["/a/g", "/a/y", "/a/", "/(a)|b/g", "/a/gi", "/\\\\d+/g", "/a/dg", "/^/gm"];
  const callables = [
    "() => 1",
    "function () {}",
    "function named() {}",
    "class {}",
    "class {\nstatic held = [];\n}",
    "async () => {}",
    "function* () {}",
  ];
  const changes: Record<string, string[]> = {
    list: [
      "it.push(9)",
      "it.pop()",
      "it.sort()",
      "it.reverse()",
      "it.fill(7)",
      "it[0] = 8",
      "it[5] = 8",
      "it.length = 0",
      "it.length = 1",
      "it.more = 1",
      "Object.freeze(it)",
      "Object.seal(it)",
      "Object.setPrototypeOf(it, null)",
      "delete it[0]",
      "it.unshift(6)",
      "it.splice(0, 1)",
      'it[0] = "text"',
      "it[0] = 1.5",
      "it[0]?.push?.(5)",
      'if (it[0] && typeof it[0] === "object") it[0].a = 5',
      "Object.defineProperty(it, 0, { get: () => 4, configurable: true })",
      "it.copyWithin(0, 1)",
    ],
    object: [
      "it.a = 9",
      "it.z = 9",
      "delete it.a",
      "Object.freeze(it)",
      "Object.seal(it)",
      "Object.setPrototypeOf(it, null)",
      "it[0] = 5",
      'it.a = "text"',
      'Object.defineProperty(it, "a", { get: () => 4, configurable: true })',
      'if (it.a && typeof it.a === "object") it.a.b = 5',
      "it.b?.push?.(5)",
      "Object.assign(it, { a: 2, q: 3 })",
      "Object.preventExtensions(it)",
    ],
    pattern: [
      'it.test("aaa")',
      'it.exec("baa")',
      "it.lastIndex = 2",
      "it.more = 1",
      'it.compile("b", "g")',
      '"aaa".replace(it, "b")',
      '"aaa".match(it)',
      '[..."aaa".matchAll(it.global ? it : /a/g)].length',
      "Object.freeze(it)",
    ],
    callable: [
      "it.more = 1",
      "it.held?.push(1)",
      "if (it.prototype) it.prototype.more = 1",
      'Object.defineProperty(it, "name", { value: "renamed" })',
      "Object.freeze(it)",
    ],
  };

  const rows: string[] = [];
  for (let id = 0, scenes = random.between(5, 11); id < scenes; id++) {
    const kind = random.weighted([
      [4, "list"],
      [4, "object"],
      [3, "pattern"],
      [2, "callable"],
    ] as const);
    const literal = random.pick(
      kind === "list" ? lists : kind === "object" ? objects : kind === "pattern" ? patterns : callables,
    );
    const inner =
      literal.startsWith("{") ||
      literal.startsWith("function") ||
      literal.startsWith("class") ||
      literal.startsWith("async")
        ? `(${literal})`
        : literal;
    const make = `make${id}`;
    rows.push(
      random.weighted<() => string>([
        [5, () => `function ${make}(x) {\nreturn ${inner};\n}`],
        [2, () => `const ${make} = x => ${inner};`],
        [2, () => `function ${make}(x) {\nconst held = ${inner};\nreturn held;\n}`],
        [2, () => `function ${make}(x, held = ${inner}) {\nreturn held;\n}`],
        [
          1,
          () =>
            `class Holder${id} {\nconstructor(x) {\nthis.x = x;\n}\nfield = ((x) => ${inner})(0);\n}\nconst ${make} = x => new Holder${id}(x).field;`,
        ],
        [
          1,
          () =>
            `const holder${id} = {\nget made() {\nconst x = 0;\nreturn ${inner};\n},\n};\nconst ${make} = () => holder${id}.made;`,
        ],
        [
          1,
          () =>
            `function* steps${id}(x) {\nfor (;;) yield ${inner};\n}\nconst walk${id} = steps${id}(0);\nconst ${make} = () => walk${id}.next().value;`,
        ],
        [1, () => `function outer${id}() {\nreturn x => ${inner};\n}\nconst ${make} = x => outer${id}()(x);`],
        [
          1,
          () =>
            `function small${id}(x) {\nreturn ${inner};\n}\nfunction ${make}(x) {\nreturn x % 2 ? small${id}(x) : small${id}(x + 1);\n}`,
        ],
        [
          1,
          () =>
            `function ${make}(x) {\nconst all = [];\nfor (let turn = 0; turn < 2; turn++) all.push(${inner});\nreturn all[0] === all[1] ? "the same in a loop" : all[x % 2];\n}`,
        ],
        [1, () => `function ${make}(x) {\nreturn unknown(${inner});\n}`],
      ])(),
    );
    const done = random.sample(changes[kind], random.between(1, 4));
    rows.push(
      `note("scene ${id}:", ${JSON.stringify(literal.split("\n")[0])});`,
      `attempt("two", () => ${make}(1) === ${make}(1));`,
      `for (let turn = 0; turn < 3; turn++)\nattempt("turn " + turn, () => {\nconst it = ${make}(turn);\nconst before = show(it);\n${done.map(change => `try {\n${change};\n} catch (error) {\nnote("refused", error.constructor.name);\n}`).join("\n")}\nreturn before + " > " + show(it);\n});`,
      `attempt("the next", () => ${make}(5));`,
    );
  }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`;
}
