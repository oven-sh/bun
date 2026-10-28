// Generators and async generators, driven by `next`, `return` and `throw` in every order, from outside and from inside themselves.
//
//   bodies      `yield` in `try`, `catch` and `finally`, `yield` in `finally` behind a `return` and behind a `throw`, `return` in `finally`, loops, `yield*` over generators, lists, texts, iterators with and
//               without `return` and `throw`, iterators that answer with what is no object; parameters with defaults that tell when they run, `arguments`, `this`
//   written as  declarations, expressions, methods of literals and classes under names, computed keys and symbols, static and private methods, `Symbol.iterator` of an object
//   driven by   `next`, `return` and `throw` with and without values, ahead of the first step, behind the end, while the generator runs; by `for .. of` with `break`, spreads, patterns, `Array.from`,
//               `Promise.all`, `yield*` of another generator
//   async       several requests at once, which wait in line; `yield` and `return` of promises that are kept and broken; `for await` over lists of promises; `return` while a request waits
//   asked       the prototypes of the function, of its `prototype` and of what it makes; `new`; `instanceof`; `Symbol.toStringTag`; whether the object is its own iterator
import type { Random } from "./random";

const head = `const lines = [];
process.on("unhandledRejection", () => {});
function show(value, depth = 0) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return String(value);
  if (value === null || typeof value !== "object") return String(value);
  if (value instanceof Error) return value.constructor.name + " " + value.message;
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  return "{" + Object.keys(value).map(key => key + ":" + show(value[key], depth + 1)).join(",") + "}";
}
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell(label, value) {
  note("runs", label);
  return value;
}
function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error);
  }
}
async function wait(label, run) {
  try {
    note(label, "=", await run());
  } catch (error) {
    note(label, "REJECTS", error);
  }
}
function steps(name, how) {
  let at = 0;
  const walk = {
    [Symbol.iterator]() {
      return walk;
    },
    next(given) {
      note("next of", name, given);
      if (how === "next answers with a number") return 1;
      return at < 2 ? { value: name + at++, done: false } : { value: "the end of " + name, done: true };
    },
  };
  if (how !== "bare") {
    walk.return = given => {
      note("return of", name, given);
      return how === "return answers with a number" ? 1 : how === "return goes on" ? { value: "not over", done: false } : { value: "returned by " + name, done: true };
    };
    if (how !== "no throw")
      walk.throw = given => {
        note("throw of", name, given);
        return { value: "caught by " + name, done: how !== "throw goes on" };
      };
  }
  return walk;
}
`;

export function generate(random: Random): string {
  let count = 0;
  const rows: string[] = [];
  for (let id = 0, scenes = random.between(4, 9); id < scenes; id++) {
    const isAsync = random.chance(0.4);
    const y = () =>
      `yield ${random.weighted([
        [5, `"y${count++}"`],
        [isAsync ? 2 : 0, `Promise.resolve("kept ${count++}")`],
        [isAsync ? 1 : 0, `Promise.reject(new Error("broken ${count++}"))`],
        [1, ""],
      ])}`;
    const statement = (depth: number): string =>
      random.weighted<() => string>([
        [5, () => `note("got", ${y()});`],
        [2, () => `${y()};`],
        [
          depth > 0 ? 4 : 0,
          () =>
            `try {\n${block(depth - 1)}\n} finally {\nnote("finally ${count++}");\n${random.pick(["", "", `${y()};`, `return "from finally ${count++}";`, block(depth - 1)])}\n}`,
        ],
        [
          depth > 0 ? 3 : 0,
          () =>
            `try {\n${block(depth - 1)}\n} catch (error) {\nnote("caught", error);\n${random.pick(["", `${y()};`, "throw error;", `return "from catch";`])}\n}`,
        ],
        [
          3,
          () =>
            `note("delegated", yield* ${random.pick(["inner()", '["a", "b"]', '"xy"', "[]", 'steps("s", "")', 'steps("s", "bare")', 'steps("s", "no throw")', 'steps("s", "return goes on")', 'steps("s", "throw goes on")', 'steps("s", "return answers with a number")', 'steps("s", "next answers with a number")', "new Set([1])"])});`,
        ],
        [1, () => `for (let turn = 0; turn < 2; turn++) note("in a loop", ${y()});`],
        [1, () => `if (${y()}) return "returned early";`],
        [1, () => `throw new Error("thrown by the body ${count++}");`],
        [isAsync ? 2 : 0, () => `await null;`],
        [
          isAsync ? 1 : 0,
          () =>
            `return Promise.${random.pick(['resolve("a kept promise")', 'reject(new Error("a broken promise"))'])};`,
        ],
        [1, () => `note("itself", typeof self?.next);\nattempt("from inside", () => self.next());`],
      ])();
    const block = (depth: number): string =>
      Array.from({ length: random.between(1, 3) }, () => statement(depth)).join("\n");
    const a = isAsync ? "async " : "";
    const parameters = random.pick(["", "", "first", `first = tell("the default", 1)`, "...rest"]);
    const body = `note("begins", typeof this, arguments.length);\n${block(2)}\nreturn "the end";`;
    const inner = `${a}function* inner() {\ntry {\nconst got = yield "inner 1";\nnote("inner got", got);\nyield "inner 2";\nreturn "the end of inner";\n} finally {\nnote("finally of inner");\n}\n}`;
    const [declared, make] = random.pick<[string, string]>([
      [`${a}function* made(${parameters}) {\n${body}\n}`, "made(1, 2)"],
      [`const made = ${a}function* (${parameters}) {\n${body}\n};`, "made(1)"],
      [`const holder = {\n${a}*made(${parameters}) {\n${body}\n},\n};`, "holder.made()"],
      [`const holder = {\n${a}*["ma" + "de"](${parameters}) {\n${body}\n},\n};`, "holder.made(1)"],
      [`class Holder {\n${a}*made(${parameters}) {\n${body}\n}\n}`, "new Holder().made()"],
      [`class Holder {\nstatic ${a}*made(${parameters}) {\n${body}\n}\n}`, "Holder.made(1, 2, 3)"],
      [
        `class Holder {\n${a}*#made(${parameters}) {\n${body}\n}\nmake() {\nreturn this.#made();\n}\n}`,
        "new Holder().make()",
      ],
      [
        `const holder = {\n${a}*[Symbol.${isAsync ? "asyncIterator" : "iterator"}](${parameters}) {\n${body}\n},\n};`,
        `holder[Symbol.${isAsync ? "asyncIterator" : "iterator"}]()`,
      ],
    ]);
    const request = () =>
      random.weighted([
        [6, `walk.next(${random.pick(["", '"in"', "1"])})`],
        [
          2,
          `walk.return(${random.pick(["", '"handed to return"', isAsync ? 'Promise.resolve("a promise handed to return")' : "2"])})`,
        ],
        [2, `walk.throw(${random.pick(['new Error("handed to throw")', '"a text"', ""])})`],
      ]);
    const drive = isAsync
      ? random.pick<() => string>([
          () =>
            Array.from({ length: random.between(2, 7) }, () => `await wait("step", () => ${request()});`).join("\n"),
          () =>
            `await wait("all at once", () => Promise.allSettled([${Array.from({ length: random.between(2, 6) }, request).join(", ")}]));`,
          () =>
            `await wait("for await", async () => {\nconst seen = [];\nfor await (const each of walk) {\nseen.push(each);\n${random.pick(["", "if (seen.length === 2) break;", 'if (seen.length === 2) throw new Error("thrown by the loop");'])}\n}\nreturn seen;\n});\nawait wait("behind", () => walk.next());`,
          () =>
            `const first = ${request()};\nconst second = ${request()};\nnote("asked twice");\nawait wait("the second", () => second);\nawait wait("the first", () => first);\nawait wait("a third", () => ${request()});`,
        ])()
      : random.pick<() => string>([
          () => Array.from({ length: random.between(2, 8) }, () => `attempt("step", () => ${request()});`).join("\n"),
          () =>
            `attempt("for of", () => {\nconst seen = [];\nfor (const each of walk) {\nseen.push(each);\n${random.pick(["", "if (seen.length === 2) break;", 'if (seen.length === 2) throw new Error("thrown by the loop");'])}\n}\nreturn seen;\n});\nattempt("behind", () => walk.next());`,
          () => `attempt("a spread", () => [...walk]);\nattempt("behind", () => walk.next());`,
          () =>
            `attempt("a pattern", () => {\nconst [first, , third] = walk;\nreturn [first, third];\n});\nattempt("behind", () => walk.next());`,
          () => `attempt("Array.from", () => Array.from(walk, each => each + "!"));`,
          () => `attempt("one step, then a spread", () => [walk.next(), ...walk]);`,
          () => `attempt("through another", () => [...(function* () {\nnote("the other got", yield* walk);\n})()]);`,
        ])();
    rows.push(
      `${isAsync ? "await (async " : "("}function scene${id}() {\nnote("scene ${id}");\nlet self;\n${inner}\n${declared}\nlet walk;\nattempt("made", () => {\nwalk = self = ${make};\nreturn typeof walk;\n});\n${drive}\n${random.chance(0.3) ? `attempt("asked", () => [Object.prototype.toString.call(walk), walk[Symbol.${isAsync ? "asyncIterator" : "iterator"}]() === walk, typeof walk.next, Object.keys(walk).length, Object.getPrototypeOf(Object.getPrototypeOf(walk)) === Object.getPrototypeOf(inner.prototype), inner.prototype.constructor === undefined, Object.getPrototypeOf(inner).constructor.name, inner() instanceof inner, Reflect.ownKeys(inner).join()]);\nattempt("new", () => new inner());` : ""}\n})();`,
    );
  }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`;
}
