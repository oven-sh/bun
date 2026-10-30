// Object literals with members of every kind, made several times with other keys and values.
//
//   keys        names, texts, whole numbers, fractions, hexadecimal numbers, big integers, symbols with and without descriptions, computed keys that tell when they run and when they become texts,
//               keys handed in that are now a new name, now the name of a neighbor, now an index, now "__proto__"; the words `get`, `set`, `async` and `static` as names
//   members     values, shorthands, methods, generators, async methods, getters, setters, pairs of both apart from each other, spreads of objects, getters, proxies, lists, texts and `null`
//   twice       a value over a value, a getter over a value, a value over a getter, a spread over either
//   __proto__   with a colon, in quotes, computed, as a shorthand, as a method, as a getter; given an object, `null` or a number
//   super       in methods, getters and setters, also when the prototype is changed later and when the method is called on another object
//   read        the order of everything, the keys with their attributes, the names of all functions, the prototype, what the members answer
import type { Random } from "./random";

const head = `const lines = [];
function show(value, depth = 0) {
  if (typeof value === "function") return "function " + JSON.stringify(value.name);
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (depth > 2) return "..";
  if (Array.isArray(value)) return "[" + Array.from(value, each => show(each, depth + 1)).join(",") + "]";
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
function named(text) {
  return {
    toString() {
      note("key to text", text);
      return text;
    },
  };
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
const base = {
  who: "base",
  a: "base.a",
  m() {
    return "base.m of " + this.who;
  },
  get g() {
    return "base.g of " + this.who;
  },
  set g(given) {
    note("base.g is set on", this.who, given);
  },
};
const other = {
  who: "other",
  a: "other.a",
  m() {
    return "other.m of " + this.who;
  },
  get g() {
    return "other.g of " + this.who;
  },
};
const mark = Symbol("mark");
function describe(holder) {
  return Reflect.ownKeys(holder)
    .map(key => {
      const found = Reflect.getOwnPropertyDescriptor(holder, key);
      const flags = (found.writable ? "w" : "") + (found.enumerable ? "e" : "") + (found.configurable ? "c" : "");
      return String(key) + ":" + ("value" in found ? show(found.value) : (found.get ? "get " + JSON.stringify(found.get.name) : "") + (found.set ? " set " + JSON.stringify(found.set.name) : "")) + ":" + flags;
    })
    .join(" ");
}
function above(holder) {
  const found = Object.getPrototypeOf(holder);
  return found === Object.prototype ? "Object.prototype" : found === base ? "base" : found === other ? "other" : found === null ? "null" : show(found);
}
function attempt(label, run) {
  try {
    note(label, run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
`;

/** The answer of the language where plain Bun has another: a line that starts with the key ends with the value. */
export const written = { "a key and the value of its member run in the order: ": "key to text, value" };

export function generate(random: Random, hasWhatIsWritten = false): string {
  let count = 0;
  const value = () =>
    random.pick(["1", "-0", '"text"', "null", "undefined", "1.5", "given", "[1]", "{ inner: 1 }", "2 ** 31"]);
  const told = () => `tell("value ${count++}", ${value()})`;
  const unnamed = () =>
    random.pick([
      "() => {}",
      "function () {}",
      "class {}",
      "async () => {}",
      "function* () {}",
      "(() => {})",
      "class {\nstatic name = 1;\n}",
    ]);
  const plainKey = () =>
    random.pick([
      "a",
      "b",
      "c",
      "d",
      "a",
      "b",
      '"a"',
      '"b c"',
      "1",
      "0",
      "1.5",
      "0x10",
      "1n",
      "get",
      "set",
      "async",
      "static",
    ]);
  const computedKey = () =>
    `[${random.pick([`tell("key ${count++}", "${random.pick(["a", "b", "c", "0"])}")`, `named("${random.pick(["a", "b", "e"])}")`, "first", "first", "second", "mark", 'Symbol.for("shared")', "Symbol()", "Symbol.iterator", '"__proto__"', "1 + 1", "`t${first}`", "null", "1.0", "-0"])}]`;
  const key = () => (random.chance(0.6) ? plainKey() : computedKey());
  const uses = () =>
    random.pick([
      "super.a",
      "super.m()",
      "super.g",
      "[super.a, this.who]",
      "(super.g = 1)",
      "super.missing",
      "(() => super.m())()",
      'super["a"]',
      "Object.keys(this).length",
    ]);

  const rows: string[] = [];
  for (let id = 0, scenes = random.between(4, 8); id < scenes; id++) {
    const members: string[] = [];
    let hasPrototype = false;
    // Plain Bun lists a getter or a setter that is written twice at the place of the second, so none is.
    const taken = new Set<string>();
    const once = (kind: string): string => {
      for (;;) {
        const name = key().replace("1n", "2");
        const spelled = `${kind} ${name.replaceAll('"', "")}`;
        if (taken.has(spelled)) continue;
        if (!name.startsWith("[")) taken.add(spelled);
        return name;
      }
    };
    let hasOwnPrototypeMember = false;
    for (let left = random.between(2, 9); left > 0; left--)
      members.push(
        random.weighted<() => string>([
          // Plain Bun makes a text of a computed key behind the value of the member, so where the key tells of that the value is quiet.
          [6, (name = key()) => `${name}: ${random.chance(0.5) && !name.includes("named(") ? told() : value()}`],
          [2, () => `${key()}: ${unnamed()}`],
          [1, () => random.pick(["given", "first", "second"])],
          [3, () => `${key()}() {\nreturn ${uses()};\n}`],
          [1, () => `${random.pick(["async ", "*", "async *"])}${key().replace("1n", "2")}() {}`],
          [3, () => `get ${once("get")}() {\nnote("a getter runs");\nreturn ${uses()};\n}`],
          [2, () => `set ${once("set")}(stored) {\nnote("a setter runs", stored, ${uses()});\n}`],
          [
            3,
            () =>
              `...${random.pick(["{ a: 10, z: 11 }", `getters("g${count++}", { a: 12, hidden: 13, y: 14 })`, `watched("w${count++}", { b: 15, x: 16 })`, "[17, 18]", '"st"', "null", "undefined", "1", "given", "base", `tell("spread ${count++}", { c: 19 })`, '{ get a() {\nreturn tell("a getter of what is spread", 20);\n} }', '{ ["__proto__"]: 21 }'])}`,
          ],
          [
            hasPrototype ? 0 : 3,
            () => {
              hasPrototype = true;
              return `${random.pick(["__proto__", '"__proto__"'])}: ${random.pick(["base", "base", "other", "null", "1", "given", `tell("prototype", base)`, "undefined", "() => {}"])}`;
            },
          ],
          [
            hasOwnPrototypeMember ? 0 : 1,
            () => (
              (hasOwnPrototypeMember = true),
              random.pick([
                '["__proto__"]: base',
                "__proto__() {\nreturn 1;\n}",
                "get __proto__() {\nreturn other;\n}",
                "__proto__",
                'set __proto__(stored) {\nnote("own setter");\n}',
              ])
            ),
          ],
        ])(),
      );
    rows.push(
      `function make${id}(first, second, given, __proto__) {\nreturn {\n${members.join(",\n")},\n};\n}`,
      `for (const [first, second, given] of [["n", "o", 1], ["a", "b", "two"], ["0", "a", { who: "given" }], ["__proto__", "c", null], [mark, 1, base], ["n", "o", 2.5]]) {\nnote("scene ${id}", first, second, given);\nattempt("made", () => {\nconst made = make${id}(first, second, given, other);\nnote("is", describe(made), "|", above(made));\nfor (const key of Reflect.ownKeys(made)) {\nconst found = Reflect.getOwnPropertyDescriptor(made, key);\nif (!found) continue;\nif (typeof found.value === "function" && !/^class|^async|\\*/.test(Function.prototype.toString.call(found.value))) attempt("call " + String(key), () => made[key]());\nif (found.get) attempt("read " + String(key), () => made[key]);\nif (found.set) attempt("store " + String(key), () => (made[key] = 5));\n}\nif (Object.isExtensible(made)) Object.setPrototypeOf(made, other);\nfor (const key of Reflect.ownKeys(made)) {\nconst found = Reflect.getOwnPropertyDescriptor(made, key);\nif (found && typeof found.value === "function" && !/^class|^async|\\*/.test(Function.prototype.toString.call(found.value))) attempt("below other, on another object: " + String(key), () => found.value.call({ who: "a stranger" }));\n}\nreturn JSON.stringify(made);\n});\n}`,
    );
  }
  if (hasWhatIsWritten)
    for (let left = random.between(2, 4); left > 0; left--) {
      const member = `[{\ntoString() {\norder.push("key to text");\nreturn "${random.pick(["a", "b", "0"])}";\n},\n}]: (order.push("value"), ${random.pick(["1", "() => {}", "{}", "null"])})`;
      rows.push(
        `{\nconst order = [];\nconst made = { ${random.pick(["", "a: 1, ", "...base, ", "get b() {\nreturn 1;\n}, "])}${member}${random.pick(["", ", c: 2", ", ...other"])} };\nnote("a key and the value of its member run in the order:", order.join(", "));\nnote(describe(made));\n}`,
      );
    }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`;
}
