// The programs of classes-below-built-in-classes that are not written by hand. `bun test/aot/generate.ts classes-below-built-in-classes <where>` writes them.
// A class whose chain ends in a built-in class of the engine is made from its record WHEN FIRST TOUCHED.
// (1) every built-in class as the heritage x every way to touch the class first; (2) what happens between the definition and the first touch; (3) heritages for which the DEFINITION must throw; (4) files that are reached under two names.
// ONE HERITAGE AND ONE WAY A PROGRAM. Plain Bun is the reference.
import { programsOf, type WrittenProgram } from "../generate";

/** By the path below the folder of programs. */
const filesWritten: Record<string, string> = {};

function write(name: string, text: string, files?: Record<string, any>, extension = "js") {
  if (files) {
    filesWritten[name + "/main." + extension] = text;
    for (const [file, content] of Object.entries(files)) {
      filesWritten[name + "/" + file] = content;
    }
  } else {
    filesWritten[name + "." + extension] = text;
  }
}

const TELL = `function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
`;
// heritage -> (the arguments of a construction, what is asked of the instance)
const HERITAGES: Record<string, [string, string]> = {
  Error: ['"m"', "one.message"], TypeError: ['"m"', "one.message + one.name"], RangeError: ['"m"', "one.message + one.name"], AggregateError: ['[new Error("a")], "m"', "one.errors.length + one.message"],
  Map: ["[[1, 2]]", "one.size + one.get(1)"], Set: ["[1, 2]", "one.size"], WeakMap: ["", "one.has({})"], WeakSet: ["", "one.has({})"], WeakRef: ["{}", "typeof one.deref()"],
  Array: ["3", "one.length"], Promise: ["resolve => resolve(5)", "typeof one.then"], RegExp: ['"a", "g"', 'one.test("a") + one.flags'], Date: ["0", "one.getTime()"],
  ArrayBuffer: ["8", "one.byteLength"], DataView: ["new ArrayBuffer(8)", "one.byteLength"], Uint8Array: ["2", "one.length"], Float64Array: ["2", "one.length"], BigInt64Array: ["1", "one.length"],
  Boolean: ["true", "one.valueOf()"], Number: ["5", "one.valueOf() + 1"], String: ['"text"', "one.length + one.valueOf()"], Object: ["", "Object.keys(one).length"],
  FinalizationRegistry: ["() => {}", "typeof one.register"], Iterator: ["", "typeof one.map"], DisposableStack: ["", "one.disposed"],
};
const LOCKED_GLOBALS = new Set(["Array", "ArrayBuffer", "BigInt64Array", "Boolean", "Float64Array", "Map", "Number", "Object", "RegExp", "Set", "String", "Uint8Array", "WeakSet"]);
const LOCKED_PROTOTYPES = new Set(["Object", "Promise", "RegExp"]);
const LOCKED_PARENTS = new Set(["Array", "ArrayBuffer", "BigInt64Array", "Boolean", "Date", "Float64Array", "Map", "Number", "Object", "Promise", "RegExp", "Set", "String", "Uint8Array", "WeakMap", "WeakSet"]);
const CLASS = `class Late extends @H {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
`;
const ASK = 'tell("an instance", () => {\n  const one = @NEW;\n  return [@CHECK, one instanceof Late, one instanceof @H, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === @H].join(" ");\n});\n';
function ask(new_ = "new Late(@A)") {
  return ASK.replaceAll("@NEW", new_);
}
// way -> (what the first line says, the code behind the definition)
const TOUCHES: Record<string, [string, string | undefined]> = {
  new: ["new", ask()],
  instanceof: ["the operator instanceof", 'tell("the test", () => ({}) instanceof Late);\n' + ask()],
  typeof: ["the operator typeof", 'tell("typeof", () => typeof Late);\n' + ask()],
  "its-name": ["a read of its name", 'tell("the name", () => Late.name + Late.length);\n' + ask()],
  "its-prototype-property": ["a read of its prototype property", 'tell("a method", () => Late.prototype.method.call({ constructor: { name: "nobody" } }));\n' + ask()],
  "get-prototype-of": ["Object.getPrototypeOf", 'tell("the parent", () => Object.getPrototypeOf(Late) === @H);\n' + ask()],
  "a-static-method": ["a call of a static method", 'tell("the static", () => Late.fixed());\n' + ask()],
  "its-text": ["a conversion to a text", 'tell("the text", () => String(Late).replace(/\\s+/g, " ").slice(0, 24));\n' + ask()],
  "a-subclass": ["the definition of a class below it", "class Later extends Late {}\n" + 'tell("below", () => [new Later(@A) instanceof Late, Object.getPrototypeOf(Later) === Late, Later.fixed()].join(" "));\n' + ask()],
  "reflect-construct": ["Reflect.construct", ask("Reflect.construct(Late, [@A])")],
  "reflect-construct-as-the-new-target": ["Reflect.construct of the built-in class, whose new target it is", ask("Reflect.construct(@H, [@A], Late)")],
  "object-create": ["Object.create of its prototype property", 'tell("an heir", () => Object.create(Late.prototype) instanceof Late);\n' + ask()],
  "a-hand-over": ["a hand-over to a function", ask("(made => new made(@A))(Late)")],
  "an-array": ["an array literal that holds it", ask("new ([Late][0])(@A)")],
  "a-member-under-a-computed-key": ["an object literal that holds it, read under a key that is put together at run time", "const table = { Late };\n" + ask('new table[["La", "te"].join("")](@A)')],
  bind: ["Function.prototype.bind", 'tell("bound", () => Late.bind(null).name);\n' + ask()],
  "a-proxy": ["a proxy around it", ask("new (new Proxy(Late, {}))(@A)")],
  "own-names": ["Object.getOwnPropertyNames", 'tell("its names", () => Object.getOwnPropertyNames(Late).sort().join());\ntell("the names of its prototype property", () => Object.getOwnPropertyNames(Late.prototype).sort().join());\n' + ask()],
  "has-instance": ["Symbol.hasInstance", 'tell("the test", () => Late[Symbol.hasInstance]({}));\n' + ask()],
  "a-store-into-it": ["a store into it", 'tell("the store", () => (Late.extra = 5));\ntell("read back", () => Late.extra + Object.keys(Late).join());\n' + ask()],
  "a-definition-on-it": ["Object.defineProperty on it", 'tell("the definition", () => Object.defineProperty(Late, "extra", { value: 5 }).extra);\n' + ask()],
  freeze: ["Object.freeze of it", 'tell("frozen", () => Object.isFrozen(Object.freeze(Late)));\n' + ask()],
  "set-prototype-of": ["Object.setPrototypeOf, which gives it another parent", 'class Other {\n  static other() {\n    return "other";\n  }\n}\ntell("another parent", () => Object.setPrototypeOf(Late, Other).other());\ntell("an instance", () => new Late(@A) instanceof Late);\n'],
  "a-direct-eval": ["the text of a direct eval", 'tell("in the text", () => eval("typeof Late + Late.name"));\n' + ask()],
  "a-closure-that-runs-later": ["a closure that a timer runs", "await new Promise(resolve =>\n  setTimeout(() => {\n    " + ask().replaceAll("\n", "\n    ").replace(/ +$/, "") + "    resolve();\n  }, 1),\n);\n"],
  "a-catch-clause": ["a throw of an instance", 'tell("caught", () => {\n  try {\n    throw new Late(@A);\n  } catch (caught) {\n    return caught instanceof Late;\n  }\n});\n' + ask()],
  "a-generator": ["the body of a generator", "function* later() {\n  yield new Late(@A);\n}\n" + ask("later().next().value")],
  "the-inspector": ["Bun.inspect", 'tell("shown", () => Bun.inspect(Late));\n' + ask()],
  "a-function-declared-above-it": ["a function that is declared above it and called below it", undefined],
  never: ["nothing at all: only the class below it in the text is used", undefined],
};
for (const [heritage, [arguments_, check]] of Object.entries(HERITAGES)) {
  const plain = heritage.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()).replace(/^-+|-+$/g, "").replaceAll("big-int64", "big-int-64").replaceAll("uint8", "uint-8").replaceAll("float64", "float-64");
  for (const [way, [says, code]] of Object.entries(TOUCHES)) {
    const head = "// A class below " + heritage + " is first touched by " + says + ".\n" + TELL;
    let text;
    if (way === "a-function-declared-above-it") {
      text = head + "function make() {\n  return new Late(@A);\n}\n" + CLASS + ask("make()");
    } else if (way === "never") {
      text = head + CLASS + 'class Used extends @H {}\ntell("the other class", () => [new Used(@A) instanceof @H, Used.name].join(" "));\n';
    } else {
      text = head + CLASS + code;
    }
    write(plain + "-first-touched-by-" + way, text.replaceAll("@H", heritage).replaceAll("@A", arguments_).replaceAll("@CHECK", check));
  }
  // other modules
  const body = CLASS.replaceAll("@H", heritage);
  const use = ask().replaceAll("@H", heritage).replaceAll("@A", arguments_).replaceAll("@CHECK", check);
  const top = "// A class below " + heritage + " is defined in another file and first touched ";
  write(plain + "-first-touched-through-a-named-import", top + "through a named import.\n" + 'import { Late } from "./late.js";\n' + TELL + use, { "late.js": "export " + body });
  write(plain + "-first-touched-through-a-namespace", top + "through the namespace of that file, under a key that is put together at run time.\n" + 'import * as all from "./late.js";\n' + TELL + 'const Late = all[["La", "te"].join("")];\n' + use, { "late.js": "export " + body });
  write(plain + "-first-touched-through-a-default-import", top + "through the default import.\n" + 'import Late from "./late.js";\n' + TELL + use, { "late.js": "export default " + body });
  write(plain + "-first-touched-through-import", top + "through import().\n" + TELL + 'const { Late } = await import("./late.js");\n' + use, { "late.js": "export " + body });
  write(plain + "-first-touched-through-require", top + "through require of a CommonJS file.\n" + TELL + 'const { Late } = require("./late.cjs");\n' + use, { "late.cjs": body + "module.exports = { Late };\n" }, "cjs");
  write(plain + "-first-touched-as-the-exports-object", top + "as the exports object of a CommonJS file.\n" + TELL + 'const Late = require("./late.cjs");\n' + use, { "late.cjs": "module.exports = " + body.replace(/\n+$/, "") + ";\n" }, "cjs");

  // between the definition and the first touch
  const between: Record<string, [string, string, string]> = {
    "the-global-is-replaced": ["the global variable of the built-in class is given another value", "const kept = @H;\nglobalThis.@H = class Impostor {};\n", ask().replaceAll("instanceof @H", "instanceof kept").replaceAll("=== @H", "=== kept")],
    "the-global-is-deleted": ["the global variable of the built-in class is deleted", "const kept = @H;\ndelete globalThis.@H;\n", ask().replaceAll("instanceof @H", "instanceof kept").replaceAll("=== @H", "=== kept")],
    "a-static-is-added-to-the-parent": ["the built-in class gets a static member", '@H.added = () => "added";\n', 'tell("inherited", () => Late.added());\n' + ask()],
    "a-method-is-added-to-the-parent": ["the prototype object of the built-in class gets a method", '@H.prototype.added = function () {\n  return "added to " + this.constructor.name;\n};\n', 'tell("inherited", () => new Late(@A).added());\n' + ask()],
    "the-parent-gets-another-parent": ["the built-in class gets another prototype", 'Object.setPrototypeOf(@H, { above: () => "above" });\n', 'tell("inherited", () => Late.above());\n' + ask()],
    "an-error-is-thrown-and-caught": ["an error is thrown and caught", "try {\n  null.x;\n} catch {}\n", ask()],
    "a-collection": ["the collector runs", "Bun.gc(true);\n", ask()],
  };
  for (const [name, [says, middle, after]] of Object.entries(between)) {
    // What the lock on built-in objects refuses says nothing about when a class is made: at run time it is left out here; at build time the refusal is stored, by the convention of run-programs.ts.
    if (name === "the-parent-gets-another-parent" && LOCKED_PARENTS.has(heritage)) {
      continue;
    }
    if (["the-global-is-replaced", "the-global-is-deleted"].includes(name) && LOCKED_GLOBALS.has(heritage) || name === "a-method-is-added-to-the-parent" && LOCKED_PROTOTYPES.has(heritage)) {
      filesWritten[plain + "-and-" + name + "-before-the-first-touch.build-errors.txt"] = "error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable\n";
    }
    write(plain + "-and-" + name + "-before-the-first-touch", ("// Between the definition of a class below " + heritage + " and its first touch " + says + ".\n" + TELL + CLASS + middle + after).replaceAll("@H", heritage).replaceAll("@A", arguments_).replaceAll("@CHECK", check));
  }

  // what runs at the definition
  write(
    plain + "-with-parts-that-run-at-the-definition", ("// The computed names, static initializers and static blocks of a class below " + heritage + " run where the class is defined, in their order, whenever it is first touched.\n" + TELL + "const order = [];\n" +
      'const named = text => (order.push("name " + text), text);\nclass Late extends (order.push("heritage"), @H) {\n  [named("first")]() {}\n  static [named("second")] = order.push("initializer");\n  static {\n    order.push("block " + (this === Late));\n  }\n  method() {\n    return "method of " + this.constructor.name;\n  }\n}\n' +
      'order.push("behind the definition");\n' + ask() + 'console.log(order.join(" | "));\n').replaceAll("@H", heritage).replaceAll("@A", arguments_).replaceAll("@CHECK", check),
  );
  write(plain + "-used-in-its-dead-zone", ("// A class below " + heritage + " is used above its definition: a ReferenceError, whenever it is made.\n" + TELL + 'tell("too early", () => new Late(@A));\ntell("too early", () => typeof Late);\n' + CLASS + ask()).replaceAll("@H", heritage).replaceAll("@A", arguments_).replaceAll("@CHECK", check));
  write(
    plain + "-defined-in-a-loop", ("// A class below " + heritage + " is defined in a loop: each turn makes a class of its own.\n" + TELL + "const made = [];\nfor (let turn = 0; turn < 3; turn++) {\n" + CLASS.replace(/\n+$/, "").split("\n").map(line => "  " + line + "\n").join("") + "  made.push(Late);\n}\n" +
      'tell("three classes", () => [made[0] === made[1], made[1] === made[2], new made[0](@A) instanceof made[1], new made[2](@A) instanceof made[2], made[1].fixed()].join(" "));\n').replaceAll("@H", heritage).replaceAll("@A", arguments_).replaceAll("@CHECK", check),
  );
  write(
    plain + "-defined-by-a-function-called-twice", ("// A class below " + heritage + " is defined in a function that is called twice: each call makes a class of its own.\n" + TELL + "function define() {\n" + CLASS.replace(/\n+$/, "").split("\n").map(line => "  " + line + "\n").join("") + "  return Late;\n}\nconst first = define();\nconst second = define();\n" +
      'tell("two classes", () => [first === second, new first(@A) instanceof second, new second(@A) instanceof second, first.fixed()].join(" "));\n').replaceAll("@H", heritage).replaceAll("@A", arguments_).replaceAll("@CHECK", check),
  );
}

// heritages for which the definition itself must throw, or the construction
for (const [name, heritage] of Object.entries({
  proxy: "Proxy", math: "Math", json: "JSON", reflect: "Reflect", "parse-int": "parseInt", "a-method-of-array": "Array.prototype.map", "a-bound-built-in-class": "Error.bind(null)", "function-prototype": "Function.prototype",
  symbol: "Symbol", "big-int": "BigInt", "an-arrow-function": "(() => {})", undefined: "undefined", "a-number": "5", null: "null",
})) {
  for (const [late, tail] of [["is-never-touched", ""], ["is-touched-later", 'tell("the touch", () => typeof Late);\ntell("an instance", () => typeof new Late());\n']]) {
    write(
      "a-class-below-" + name + "-" + late, "// `class Late extends " + heritage + "`: whether the definition throws, and where, is as in plain Bun, whenever the class would be made.\n" + TELL +
        'console.log("above the definition");\nlet Late;\ntell("the definition", () => {\n  Late = class extends ' + heritage + ' {};\n  return "done";\n});\nconsole.log("below the definition");\n' + tail,
    );
  }
}

// files that are reached under two names
const INNER = "globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;\nclass Late extends @H {\n  static count = 0;\n  static next() {\n    return ++Late.count;\n  }\n}\n";
for (const heritage of ["Error", "Map", "Array", "Promise"]) {
  const plain = heritage.toLowerCase();
  write(
    plain + "-in-a-file-imported-under-two-queries", "// An ES module that defines a class below " + heritage + " is imported under two names that differ in their query.\n" + TELL +
      'const first = (await import("./late.js?one")).default;\nconst second = (await import("./late.js?two")).default;\ntell("the classes", () => [first === second, first.next(), second.next(), globalThis.evaluations].join(" "));\n',
    { "late.js": INNER.replaceAll("@H", heritage) + "export default Late;\n" },
  );
  write(
    plain + "-in-a-file-both-imported-and-required", "// A file that defines a class below " + heritage + " is imported and required.\n" + TELL +
      'const first = (await import("./late.cjs")).default;\nconst second = require("./late.cjs");\ntell("the classes", () => [first === second, first.next(), second.next(), globalThis.evaluations].join(" "));\n',
    { "late.cjs": INNER.replaceAll("@H", heritage) + "module.exports = Late;\n" },
  );
}

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
