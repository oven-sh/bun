// Patterns that take lists and objects apart, where everything that runs on the way says so.
//
//   sources     lists with and without holes, texts, sets, maps, typed arrays, `arguments`, generators with `finally`, iterators that tell of `next` and `return`, that end early, throw, or have a
//               `return` that is missing, cannot be called, throws or answers with what is no object; objects with getters, proxies that tell of every trap, `null`, `undefined`, numbers
//   patterns    holes, names, defaults, rests, keys that are names, texts, numbers and computed, patterns in patterns, up to three deep
//   defaults    tell when they run, read names bound earlier and names bound later, throw, are functions and classes without names
//   targets     new names of `const`, `let` and `var`; parameters of functions, arrows, methods, setters, constructors and generators; `catch`; the heads of `for .. of` and `for .. in`;
//               in assignments: variables, members of objects that tell when they are read, members under computed keys, setters, members that cannot be written
//   read        the order of everything, what each name holds, what is thrown, and what had been assigned by then
import type { Random } from "./random";

const head = `const lines = [];
function show(value, depth = 0) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + Array.from(value, each => show(each, depth + 1)).join(",") + "]";
  if (value instanceof Error) return value.constructor.name + " " + value.message;
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).map(key => key + ":" + show(value[key], depth + 1)).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell(label, value) {
  note("runs", label);
  return value;
}
function fail(label) {
  note("throws", label);
  throw new RangeError(label);
}
function failure(error) {
  return error instanceof Error ? error.constructor.name + (error instanceof RangeError ? " " + error.message : "") : show(error);
}
function steps(name, items, how) {
  let at = 0;
  const walk = {
    next() {
      note("next of", name, at);
      if (how === "next throws" && at === 1) fail("next of " + name);
      if (how === "next answers with a number" && at === 1) return 1;
      return at < items.length ? { value: items[at++], done: false } : { value: "the value at the end", done: true };
    },
  };
  if (how === "return is no function") walk.return = 1;
  else if (how === "return is null") walk.return = null;
  else if (how !== "no return")
    walk.return = function (...given) {
      note("return of", name, given.length, this === walk);
      if (how === "return throws") fail("return of " + name);
      return how === "return answers with a number" ? 1 : {};
    };
  return {
    [Symbol.iterator]() {
      note("iterator of", name);
      return walk;
    },
  };
}
function* made(name, items) {
  try {
    for (const item of items) {
      note("yields", name, item);
      yield item;
    }
  } finally {
    note("finally of", name);
  }
}
function getters(name, members) {
  const holder = {};
  for (const key of Reflect.ownKeys(members))
    Object.defineProperty(holder, key, {
      get() {
        note("get", name, String(key));
        return members[key];
      },
      enumerable: key !== "hidden",
      configurable: true,
    });
  return holder;
}
function watched(name, target) {
  return new Proxy(target, {
    get(inner, key) {
      note("trap get", name, String(key));
      return inner[key];
    },
    has(inner, key) {
      note("trap has", name, String(key));
      return key in inner;
    },
    ownKeys(inner) {
      note("trap ownKeys", name);
      return Reflect.ownKeys(inner);
    },
    getOwnPropertyDescriptor(inner, key) {
      note("trap getOwnPropertyDescriptor", name, String(key));
      return Reflect.getOwnPropertyDescriptor(inner, key);
    },
  });
}
function named(text) {
  return {
    toString() {
      note("key to text", text);
      return text;
    },
  };
}
`;

/** The answers of the language where plain Bun has others: a line that starts with a key ends with its value. */
export const written = {
  "a function behind a comma is named ": '""',
  "a default that reads a name of its own pattern on the second turn ": "THROWS ReferenceError",
};

export function generate(random: Random, hasWhatIsWritten = false): string {
  let count = 0;
  const leaf = () =>
    random.pick(["1", "undefined", "null", '"text"', "0", "[5, 6]", "{ a: 7, b: 8 }", "undefined", "-0", "NaN"]);
  const items = (depth: number): string =>
    `[${Array.from({ length: random.between(0, 4) }, () => (depth > 0 && random.chance(0.35) ? source(depth - 1) : random.chance(0.1) ? "" : leaf())).join(", ")}]`;
  const members = (depth: number): string =>
    `{ ${random
      .sample(["a", "b", "c", "d", "0", "hidden"], random.between(0, 5))
      .map(key => `${key}: ${depth > 0 && random.chance(0.35) ? source(depth - 1) : leaf()}`)
      .join(", ")} }`;
  const source = (depth: number): string => {
    const name = `"s${count++}"`;
    return random.weighted<() => string>([
      [5, () => items(depth)],
      [5, () => members(depth)],
      [
        5,
        () =>
          `steps(${name}, ${items(depth)}, "${random.pick(["", "", "", "no return", "next throws", "next answers with a number", "return is no function", "return is null", "return throws", "return answers with a number"])}")`,
      ],
      [2, () => `made(${name}, ${items(depth)})`],
      [4, () => `getters(${name}, ${members(depth)})`],
      [2, () => `watched(${name}, ${random.chance(0.5) ? members(depth) : items(depth)})`],
      [
        1,
        () =>
          random.pick([
            '"ab"',
            "new Set([1, 2, 3])",
            'new Map([["k", 1]])',
            "new Uint8Array([1, 2])",
            "(function () {\nreturn arguments;\n})(1, 2)",
            '"\\u{1F600}x"',
          ]),
      ],
      [1, () => random.pick(["null", "undefined", "1", "true", "Symbol.iterator", "() => {}"])],
    ])();
  };

  /** `isBinding`: the targets are new names. Otherwise they are variables declared ahead and members of `holder`. */
  const build = (isBinding: boolean, isHeadOfALoop: boolean) => {
    const names: string[] = [];
    const target = (): string => {
      if (isBinding || random.chance(0.35)) {
        const name = `v${count++}`;
        names.push(name);
        return name;
      }
      return random.pick([
        `holder.p${count++}`,
        `tell("the object", holder).p${count++}`,
        `holder[tell("the key", "k${count++}")]`,
        `tell("the object", holder)[tell("the key", "k${count++}")]`,
        `holder.setter`,
        `holder.fixed`,
        `holder[named("n${count++}")]`,
        `holder.inner.p${count++}`,
      ]);
    };
    const initial = (): string => {
      const label = `"default ${count++}"`;
      // The last name is the one that the default stands behind.
      const earlier = isHeadOfALoop ? names.slice(0, -1) : names;
      return random.weighted([
        [6, `tell(${label}, ${leaf()})`],
        [2, `tell(${label}, ${source(0)})`],
        [earlier.length ? 2 : 0, `tell(${label}, ${earlier.length ? random.pick(earlier) : 0})`],
        // In the head of a loop, from the second turn on, plain Bun reads what the name held on the turn before.
        [isBinding && !isHeadOfALoop ? 0.5 : 0, `tell(${label}, v${count + random.between(0, 2)})`],
        [0.5, `fail(${label})`],
        [1, random.pick(["() => {}", "function () {}", "class {}", "(() => {})"])],
      ]);
    };
    const element = (depth: number): string => {
      const inner = depth > 0 && random.chance(0.35) ? pattern(depth - 1) : target();
      return random.chance(0.45)
        ? `${inner} = ${inner.startsWith("[") || inner.startsWith("{") ? `tell("default ${count++}", ${source(0)})` : initial()}`
        : inner;
    };
    const pattern = (depth: number): string => {
      if (random.chance(0.5)) {
        const parts = Array.from({ length: random.between(0, 4) }, () => (random.chance(0.12) ? "" : element(depth)));
        if (random.chance(0.3)) parts.push(`...${depth > 0 && random.chance(0.3) ? pattern(depth - 1) : target()}`);
        return `[${parts.join(", ")}]`;
      }
      const parts = Array.from({ length: random.between(0, 4) }, () => {
        const key = random.weighted([
          [5, random.pick(["a", "b", "c", "d", "missing", "hidden", "length"])],
          [1, random.pick(['"a"', "0", '"b"'])],
          [2, `[tell("key ${count++}", "${random.pick(["a", "b", "c", "0"])}")]`],
          [1, `[named("${random.pick(["a", "b", "c"])}")]`],
        ]);
        if (isBinding && /^[a-z]+$/.test(key) && random.chance(0.3)) {
          // A shorthand binds the key's own name, which is taken once.
          const name = `${key}`;
          if (!names.includes(name) && !["length", "missing", "hidden"].includes(name)) {
            names.push(name);
            return random.chance(0.5) ? `${name} = ${initial()}` : name;
          }
        }
        return `${key}: ${element(depth)}`;
      });
      if (random.chance(0.3)) parts.push(`...${target()}`);
      return `{ ${parts.join(", ")} }`;
    };
    const text = pattern(random.between(0, 2));
    return { text, names };
  };

  const rows: string[] = [];
  for (let id = 0, scenes = random.between(5, 10); id < scenes; id++) {
    const context = random.pick([
      "const",
      "let",
      "var",
      "assignment",
      "assignment",
      "assignment",
      "function",
      "arrow",
      "method",
      "setter",
      "constructor",
      "generator",
      "default",
      "catch",
      "for of",
      "for of assignment",
      "for in",
      "async arrow",
    ] as const);
    const isBinding = !context.includes("assignment");
    const { text, names } = build(isBinding, context.startsWith("for"));
    const from = source(2);
    const shown = `note("holds", ${[...names.map(name => `"${name}", ${name}`), `"holder", holder`].join(", ")});`;
    let body: string;
    if (context === "const" || context === "let" || context === "var") body = `${context} ${text} = ${from};\n${shown}`;
    else if (context === "assignment")
      body = `${names.length ? `let ${names.join(", ")};\n` : ""}try {\nnote("the value", (${text} = ${from}) === undefined);\n} finally {\n${shown}\n}`;
    else if (context === "function")
      body = `function takes(${text}, last = tell("the last default", 1)) {\n${shown}\n}\nnote("length", takes.length);\ntakes(${from});`;
    else if (context === "arrow")
      body = `const takes = (first = tell("the first default", 1), ${text}) => {\n${shown}\n};\ntakes(undefined, ${from});`;
    else if (context === "async arrow")
      body = `const takes = async (${text}) => {\n${shown}\n};\nawait takes(${from});`;
    else if (context === "method") body = `const has = {\ntakes(${text}) {\n${shown}\n},\n};\nhas.takes(${from});`;
    else if (context === "setter") body = `const has = {\nset takes(${text}) {\n${shown}\n},\n};\nhas.takes = ${from};`;
    else if (context === "constructor")
      body = `class Takes {\nfield = tell("the field", 1);\nconstructor(${text}) {\n${shown}\n}\n}\nnew Takes(${from});`;
    else if (context === "generator")
      body = `function* takes(${text}) {\n${shown}\n}\nconst walk = takes(${from});\nnote("made");\nwalk.next();`;
    else if (context === "default")
      body = `function takes(${text} = ${from}) {\n${shown}\n}\ntakes();\ntakes(undefined);`;
    else if (context === "catch") body = `try {\nthrow ${from};\n} catch (${text}) {\n${shown}\n}`;
    else if (context === "for of")
      body = `for (${random.pick(["const", "let", "var"])} ${text} of [${from}, ${source(1)}]) {\n${shown}\n}`;
    else if (context === "for of assignment")
      body = `${names.length ? `let ${names.join(", ")};\n` : ""}for (${text} of [${from}, ${source(1)}]) {\n${shown}\n}`;
    else body = `for (const ${text} in { ab: 1, c: 2 }) {\n${shown}\n}`;
    rows.push(
      `${context === "async arrow" ? "await (async " : "("}function scene${id}() {\nnote("scene ${id}: ${context}");\nconst holder = {\ninner: {},\nset setter(given) {\nnote("the setter gets", given);\n},\n};\nObject.defineProperty(holder, "fixed", { value: "fixed", enumerable: false });\ntry {\n${body}\n} catch (error) {\nnote("THROWS", failure(error), holder);\n}\n})();`,
    );
  }
  if (hasWhatIsWritten)
    for (let left = random.between(2, 5); left > 0; left--) {
      const unnamed = `(${random.pick(["0", '"a"', "null", "0, 1"])}, ${random.pick(["() => {}", "function () {}", "class {}", "async () => {}"])})`;
      const declares = random.pick(["const", "let"]);
      rows.push(
        random.pick([
          `{\nconst { a = ${unnamed} } = {};\nnote("a function behind a comma is named", JSON.stringify(a.name));\n}`,
          `{\nconst [a = ${unnamed}] = [];\nnote("a function behind a comma is named", JSON.stringify(a.name));\n}`,
          `{\nlet a;\n[a = ${unnamed}] = [];\nnote("a function behind a comma is named", JSON.stringify(a.name));\n}`,
          `(function (a = ${unnamed}, { b = ${unnamed} } = {}) {\nnote("a function behind a comma is named", JSON.stringify(a.name + b.name));\n})();`,
          ...[
            `for (${declares} { a = a } of [{ a: 1 }, {}]) seen.push(a);`,
            `for (${declares} [a = b, b] of [[1, 2], []]) seen.push(a, b);`,
            `for (${declares} [, a = b, b] in { xyz: 1, x: 2 }) seen.push(a, b);`,
            `for (${declares} { a = a } of [{ a: 1 }, {}]) seen.push(() => a);`,
            `for (${declares} { a: [b = b] } of [{ a: [1] }, { a: [] }]) seen.push(b);`,
          ].map(
            loop =>
              `try {\nconst seen = [];\n${loop}\nnote("a default that reads a name of its own pattern on the second turn", "answers", seen.length);\n} catch (error) {\nnote("a default that reads a name of its own pattern on the second turn", "THROWS", error.constructor.name);\n}`,
          ),
        ]),
      );
    }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`;
}
