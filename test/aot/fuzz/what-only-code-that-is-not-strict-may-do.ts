// A CommonJS file in sloppy mode, doing what strict code may not.
//
//   arguments   the object shares its elements with the parameters, both ways, as far as arguments were handed in; until an element is deleted or redefined; not at all where the parameters
//               have defaults, patterns or a rest; handed to other functions that change it; read in closures; `arguments` declared and shadowed
//   names       a store to a name nobody declared makes a global; `delete` of such a name, of a variable, of a parameter; `typeof` of a name nobody declared;
//               a function, a `var` and a parameter of one name; the words `let`, `yield`, `static`, `await`, `interface` as names
//   stores      to a frozen object, to a member that only has a getter, to a text's length, to `undefined`, `NaN` and `Infinity`, to the own name of a function expression: nothing happens;
//               `delete` of what cannot be deleted answers `false`
//   with        names looked up in an object, in a proxy that tells of every question, with `Symbol.unscopables`; stores, calls that get the object as `this`, declarations inside, closures that outlive it
//   eval        a direct `eval` that declares variables and functions in the function around it
//   numbers     octal literals and octal escapes
//   the file    `this`, `arguments` and `return` at the top of the file
import type { Random } from "./random";

const head = `var lines = [];
function show(value, depth) {
  depth = depth || 0;
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return String(value);
  if (value === null || typeof value !== "object") return Object.is(value, -0) ? "-0" : String(value);
  if (depth > 2) return "..";
  if (value === globalThis) return "the global object";
  var kind = Object.prototype.toString.call(value).slice(8, -1);
  return (kind === "Object" || kind === "Array" ? "" : kind) + "{" + Object.keys(value).map(function (key) { return key + ":" + show(value[key], depth + 1); }).join(",") + "}";
}
function note() {
  lines.push(Array.prototype.map.call(arguments, function (part) { return typeof part === "string" ? part : show(part); }).join(" "));
}
function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
function changes(list) {
  list[0] = "changed elsewhere";
  list[1] = "changed elsewhere too";
  return list.length;
}
function watched(label, target) {
  return new Proxy(target, {
    has: function (inner, key) {
      if (typeof key === "string") note("trap has", label, key);
      return key in inner;
    },
    get: function (inner, key) {
      if (typeof key === "string") note("trap get", label, key);
      return inner[key];
    },
    set: function (inner, key, value) {
      note("trap set", label, key);
      inner[key] = value;
      return true;
    },
  });
}
`;

export function generate(random: Random): string {
  let count = 0;
  const given = () =>
    random.pick(["", "1", "1, 2", "1, 2, 3", "undefined", "undefined, 2", '"a", "b"', "{ p: 1 }, [2]"]);
  const step = () =>
    random.pick([
      'arguments[0] = "stored in the object";',
      'arguments[1] = "stored in the object";',
      'a = "stored in the parameter";',
      'b = "stored in the parameter";',
      "delete arguments[0];",
      "delete arguments[1];",
      "arguments.length = 1;",
      "arguments.length = 5;",
      'Object.defineProperty(arguments, "0", { value: "defined" });',
      'Object.defineProperty(arguments, "0", { writable: false });',
      'Object.defineProperty(arguments, "1", { get: function () {\nreturn "a getter";\n}, configurable: true });',
      "Object.preventExtensions(arguments);",
      "changes(arguments);",
      '(function () {\na = "stored by a closure";\n})();',
      "a++;",
      "arguments[0]++;",
      'arguments[2] = "beyond the parameters";',
      "Array.prototype.reverse.call(arguments);",
      'Array.prototype.push.call(arguments, "pushed");',
      "[a, b] = [b, a];",
    ]);
  const seen = `note("holds", a, b, arguments.length, arguments[0], arguments[1], Object.keys(arguments).join());`;

  const kinds: (() => string)[] = [
    () => {
      const name = `shares${count++}`;
      const parameters = random.weighted([
        [6, "a, b"],
        [1, "a, b = 5"],
        [1, "a, ...b"],
        [1, "a, { b } = {}"],
        [1, "a, b, c"],
      ]);
      return `function ${name}(${parameters}) {\n${seen}\n${Array.from({ length: random.between(1, 4) }, () => `${step()}\n${seen}`).join("\n")}\nreturn [a, b];\n}\n${Array.from(
        { length: random.between(1, 3) },
        () => given(),
      )
        .map(list => `attempt("${name}(${list.replaceAll('"', "'")})", function () {\nreturn ${name}(${list});\n});`)
        .join("\n")}`;
    },
    () => {
      const name = `shares${count++}`;
      return `function ${name}(a, b) {\nvar late = function () {\nreturn [a, arguments.length];\n};\nvar arrow = () => [a, arguments[0], arguments.length];\n${step()}\nreturn [late(1, 2, 3), arrow(4), ${random.pick(["arguments.callee === " + name, "typeof arguments.callee", "Object.prototype.toString.call(arguments)", "arguments[Symbol.iterator] === Array.prototype.values", "[...arguments]"])}];\n}\nattempt("${name}", function () {\nreturn ${name}(${given()});\n});`;
    },
    () =>
      random.pick([
        `attempt("arguments as a variable", function () {\nvar arguments = [7];\nreturn arguments[0];\n});`,
        `attempt("arguments declared and left alone", function (a) {\nvar arguments;\nreturn typeof arguments;\n});`,
        `attempt("arguments as a parameter", function () {\nreturn (function (arguments) {\nreturn arguments;\n})(5);\n});`,
        `attempt("a function named arguments", function () {\nreturn (function () {\nfunction arguments() {}\nreturn typeof arguments;\n})(1);\n});`,
      ]),
    () => {
      const name = `made${count++}`;
      return `attempt("a store to a name nobody declared", function () {\nvar before = typeof ${name};\n${name} = ${random.pick(["1", "{ a: 1 }", "function () {}"])};\nvar found = [before, typeof ${name}, "${name}" in globalThis, Object.getOwnPropertyDescriptor(globalThis, "${name}").configurable];\nfound.push(delete ${name}, typeof ${name});\nreturn found;\n});`;
    },
    () =>
      `attempt("delete of names", function (parameter) {\nvar variable = 1;\nfunction declared() {}\nreturn [delete variable, delete parameter, delete declared, delete nobody${count++}, typeof variable, delete globalThis.nobody, delete Math.PI, delete [].length, delete Object.prototype];\n});`,
    () =>
      random.pick([
        `attempt("a function over a parameter", function () {\nreturn (function (a) {\nvar first = typeof a;\nfunction a() {}\nreturn [first, typeof a];\n})(1);\n});`,
        `attempt("a var beside a parameter", function () {\nreturn (function (a) {\nvar a;\nvar b = a;\nvar a = 2;\nreturn [a, b, arguments[0]];\n})(1);\n});`,
        `attempt("words as names", function () {\nvar let = 1, yield = 2, static = 3, await = 4, interface = 5, package = 6, implements = 7, private = 8;\nreturn let + yield + static + await + interface + package + implements + private;\n});`,
      ]),
    () =>
      `attempt("stores that do nothing", function () {\nvar frozen = Object.freeze({ a: 1, list: [1] });\nvar only = {\nget g() {\nreturn "from the getter";\n},\n};\nvar text = "text";\nfrozen.a = 2;\nfrozen.b = 3;\nonly.g = 4;\ntext.length = 1;\ntext[0] = "x";\ntext.more = 1;\nundefined = 5;\nNaN = 6;\nInfinity = 7;\n(1).more = 8;\nvar named = (function self() {\nself = 9;\nreturn typeof self;\n})();\nreturn [frozen, only.g, text, text.more, undefined, NaN, Infinity, named, delete frozen.a, ${random.pick(["Object.isFrozen(frozen)", "frozen.list.push(2)", "(frozen.a += 1)", "frozen.a++", "(only.g += 1)"])}];\n});`,
    () => {
      const holder = random.pick([
        "{ x: 1, f: function () {\nreturn this.x;\n} }",
        'watched("w", { x: 1, f: function () {\nreturn this === undefined ? "nothing" : typeof this;\n} })',
        'Object.create({ x: "inherited", f: function () {\nreturn this.x;\n} })',
        "{ x: 1, f: function () {\nreturn this.x;\n}, [Symbol.unscopables]: { x: true } }",
        "[10, 20]",
        '"text"',
        "new Map([[1, 2]])",
      ]);
      return `attempt("with", function () {\nvar x = "outer", y = "outer y", late;\nfunction f() {\nreturn "the outer f on " + (this === globalThis ? "the global object" : typeof this);\n}\nvar held = ${holder};\nvar found = [];\nwith (held) {\nfound.push(x, y, typeof f === "function" ? f() : "no f", typeof length, typeof size);\nx = "stored";\ny = "stored y";\nvar declared = "declared inside";\nlate = function () {\nreturn x;\n};\n${random.pick(["", "delete held.x;", 'held.y = "added";', "found.push(typeof undeclared);"])}\nfound.push(x, y);\n}\nfound.push(x, y, declared, late(), held.x);\nreturn found;\n});`;
    },
    () =>
      random.pick([
        `attempt("eval declares a variable", function () {\nvar before = typeof made;\neval("var made = 1; function also() { return made; }");\nreturn [before, typeof made, also(), delete made, typeof made];\n});`,
        `attempt("eval shadows a variable around it", function () {\nvar outer = "outer";\nreturn (function () {\nvar first = outer;\neval("var outer = 'inner'");\nreturn [first, outer];\n})().concat(outer);\n});`,
        `attempt("eval reads arguments", function () {\nreturn (function (a) {\neval("arguments[0] = 'by eval'");\nreturn a;\n})(1);\n});`,
        `attempt("eval in a default", function () {\nreturn (function (a = eval("var inDefault = 1; 2"), b = typeof inDefault) {\nreturn [a, b, typeof inDefault];\n})();\n});`,
      ]),
    () =>
      `attempt("octal", function () {\nreturn [010, 0777, 08, 09.5, 00, "\\101", "\\0", "a\\12b".length, -010, 010 .toString()];\n});`,
    () =>
      `attempt("this", function () {\nfunction plain() {\nreturn this;\n}\nreturn [plain() === globalThis, typeof plain.call(1), typeof plain.call("t"), plain.call(null) === globalThis, plain.call(undefined) === globalThis, typeof plain.call(true), typeof plain.call(Symbol.iterator), plain.call(1) == 1, plain.call(1) === 1, [1].map(plain)[0] === globalThis, typeof [1].map(plain, 5)[0], (0, plain)() === globalThis, new plain() instanceof plain];\n});`,
  ];

  const rows = Array.from({ length: random.between(8, 18) }, () => random.pick(kinds)());
  const top = random.pick([
    `note("the top of the file", this === module.exports, this === exports, arguments.length, arguments[0] === exports, typeof arguments[1], arguments[2] === module, typeof arguments[3], typeof arguments[4]);`,
    `note("the top of the file", typeof this, Object.keys(this).length);\nthis.viaThis = 1;\nnote("exports", exports);`,
    `var topLevel = 1;\nnote("a var of the file", "topLevel" in globalThis, typeof topLevel, delete topLevel);`,
  ]);
  const end = random.pick([
    `console.log(lines.join("\\n"));`,
    `console.log(lines.join("\\n"));\nreturn;\nconsole.log("behind the return");`,
    `if (lines.length) {\nconsole.log(lines.join("\\n"));\nreturn 5;\n}`,
  ]);
  return `${head}${top}\n${rows.join("\n")}\n${end}\n`;
}
