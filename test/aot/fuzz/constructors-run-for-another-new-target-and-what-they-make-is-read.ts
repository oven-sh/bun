// Constructors of every kind are run for a new target of another kind, and what they make is read in every way that hangs on how an object is laid out.
//
//   makers    functions that store to `this`, also under `length`, `size` and indices, that return an object, a list or a number, that ask for new.target or hand it on; arrows and methods, which refuse;
//             classes with fields, private names and accessors; classes below Array, Map, Set, Error, lists of bytes and of fractions, Promise, RegExp, Function, Date and others, with and without
//             fields, constructors and a species; classes below a function that returns another object; classes that answer instanceof themselves; classes that get another class above them;
//             the built-in classes themselves; functions whose `prototype` was replaced; bound functions and proxies of each
//   entered   new, Reflect.construct with and without a new target, super() of a class below the maker, Reflect.construct with the new.target of a function around it, call and apply on what
//             Object.create made, Array.from and Array.of, the from, of and resolve that a class inherits, Symbol.species, Object.setPrototypeOf, __proto__ in a literal, one shared function that
//             constructs whatever it is handed
//   read      length, elements, size, fields, methods, push, pop, set, get, add, has, message, byteLength; instanceof, Array.isArray, the prototype; keys, own keys, JSON, spread, concat, slice, map
//   shared    the functions that construct, read and show are called by the program alone, or by a listener of the host too
//   how       once or in a loop of two thousand turns; on the expression itself, through a variable, in a closure, in a shared function, in a function that declares the class; typed or not
import type { Random } from "./random";

type Base = { name: string; type?: string; arguments: string[]; reads: string[] };

const bases: Base[] = [
  {
    name: "Array",
    type: "Array<number>",
    arguments: ["", "3", "1, 2, 3", "1.5, 2"],
    reads: [
      "$.length",
      "$[0]",
      "$[1]",
      "$.push(4)",
      "$.pop()",
      "$.indexOf(2)",
      "$.map(each => each + 1).length",
      "$.slice(1).length",
      "$.join()",
      "$.at(-1)",
      "($[2] = 8)",
      "($.length = 1)",
      "$.includes(1)",
      "$.concat([9]).length",
      "[...$].length",
      "$.shift()",
      "$.unshift(7)",
    ],
  },
  {
    name: "Map",
    type: "Map<number, number>",
    arguments: ["", "[[1, 2]]"],
    reads: ["$.size", "$.set(3, 4).size", "$.get(1)", "$.has(3)", "[...$.keys()].join()", "$.delete(1)"],
  },
  {
    name: "Set",
    type: "Set<number>",
    arguments: ["", "[1, 2]"],
    reads: ["$.size", "$.add(3).size", "$.has(1)", "[...$].join()", "$.delete(1)"],
  },
  { name: "Error", arguments: [`"failed"`, ""], reads: ["$.message", "$.name", "typeof $.stack", "String($)"] },
  { name: "TypeError", arguments: [`"of a type"`], reads: ["$.message", "$.name", "$ instanceof Error"] },
  {
    name: "Uint8Array",
    arguments: ["4", "[1, 2, 3]"],
    reads: [
      "$.length",
      "$[0]",
      "$.byteLength",
      "($[1] = 300)",
      "$[1]",
      "$.subarray(1).length",
      "$.slice(1).length",
      "$.join()",
      "$.at(-1)",
      "$.indexOf(2)",
      "$.byteOffset",
    ],
  },
  {
    name: "Float64Array",
    arguments: ["2", "[1.5, 2.5]"],
    reads: ["$.length", "$[0]", "$.byteLength", "($[1] = 0.25)", "$[1]", "$.join()", "$.map(each => each * 2)[0]"],
  },
  {
    name: "Promise",
    type: "Promise<number>",
    arguments: ["function () { arguments[0](6); }"],
    reads: ["typeof $.then", "$ instanceof Promise", "typeof $.then(() => 1).then"],
  },
  {
    name: "RegExp",
    arguments: [`"a+", "g"`, `"b"`],
    reads: [`$.test("caab")`, "$.lastIndex", "$.source", "$.flags", `$.exec("xaab")?.index`, "$.global"],
  },
  { name: "Function", arguments: [`"return 7"`], reads: ["$.apply(null, [])", "$.length", "typeof $", "$.call(null)"] },
  {
    name: "Date",
    arguments: ["86400000"],
    reads: ["$.getTime()", "$.getUTCDate()", "$.setUTCDate(3)", "$.toISOString()"],
  },
  { name: "ArrayBuffer", arguments: ["8"], reads: ["$.byteLength", "$.slice(2).byteLength"] },
  {
    name: "DataView",
    type: "DataView<ArrayBuffer>",
    arguments: ["new ArrayBuffer(8)"],
    reads: ["$.byteLength", "($.setInt8(1, 9), $.getInt8(1))", "$.byteOffset"],
  },
  { name: "String", arguments: [`"text"`], reads: ["$.length", "$.charAt(1)", `$ + "!"`, "$[0]", "$.valueOf()"] },
  { name: "Number", arguments: ["12"], reads: ["$.valueOf()", "$.toFixed(1)"] },
  { name: "Boolean", arguments: ["true"], reads: ["$.valueOf()"] },
  { name: "Object", arguments: ["", "{ given: 1 }"], reads: ["Object.keys($).join()", "typeof $.valueOf()"] },
  {
    name: "WeakMap",
    type: "WeakMap<object, number>",
    arguments: [""],
    reads: ["$.set(anchor, 4).get(anchor)", "$.has(anchor)"],
  },
  { name: "WeakSet", type: "WeakSet<object>", arguments: [""], reads: ["$.add(anchor).has(anchor)"] },
];

// Every one of them may be asked of every object.
const reads = [
  "$.length",
  "$.length",
  "$.length",
  "$[0]",
  "$[0]",
  "$[1]",
  "$.size",
  "$.size",
  "$.x",
  "$.x",
  "$.y",
  "$.z",
  "$.tag",
  "$.count",
  "$.by",
  "$.made",
  "$.byteLength",
  "$.message",
  "$.name",
  "$.source",
  "$.lastIndex",
  "typeof $",
  "typeof $.then",
  "typeof $.stack",
  "$.push(4)",
  "$.push(4.5)",
  "$.pop()",
  "$.shift()",
  "$.set(1, 2).size",
  "$.get(1)",
  "$.add(1).size",
  "$.has(1)",
  `$.test("caab")`,
  "$()",
  "$.getTime()",
  "$.valueOf()",
  "$.total()",
  "$.total()",
  "$.double",
  "$.reveal()",
  "$.w",
  "Array.isArray($)",
  "Array.isArray($)",
  "Object.keys($).join()",
  "Object.keys($).join()",
  "named(Reflect.ownKeys($))",
  "named(Object.getOwnPropertyNames($))",
  "JSON.stringify($)",
  "JSON.stringify($)",
  "JSON.stringify([$])",
  "Object.prototype.toString.call($)",
  "$.constructor.name",
  "[...$]",
  "[...$].length",
  "[0].concat($).length",
  "[0].concat($)",
  "Array.prototype.slice.call($).length",
  "Array.prototype.map.call($, each => each).length",
  "Array.prototype.push.call($, 6)",
  "Array.prototype.join.call($)",
  "Array.from($).length",
  "Object.entries($).length",
  "Object.values($)",
  "({ ...$ })",
  "Object.assign({}, $)",
  "($.length = 2)",
  "($.length = 0)",
  "($[3] = 9)",
  "($[0] = 1.5)",
  "($.x = 2.5)",
  `($.x = "text")`,
  "($.size = 4)",
  `($.tag = "stored")`,
  "delete $.x",
  "delete $.length",
  "delete $[0]",
  `show(Object.getOwnPropertyDescriptor($, "length"))`,
  `show(Object.getOwnPropertyDescriptor($, "x"))`,
  `"length" in $`,
  `"x" in $`,
  `Object.hasOwn($, "length")`,
  `Object.hasOwn($, "x")`,
  `Object.hasOwn($, "z")`,
  "$.at(0)",
  "$.indexOf(2)",
  "$.includes(2)",
  `$.join("-")`,
  "$.fill(1)",
  "$.reverse()",
  "$.sort()",
  "$.map(each => each * 2)",
  "$.slice(0)",
  "$.filter(each => each > 1)",
  "$.concat([1])",
  "$.flat()",
  "$.splice(0, 1)",
  "$.subarray(1)",
  "$.keys().next().value",
  "$.entries().next().value",
  "$.forEach(each => note(show(each)))",
  "ArrayBuffer.isView($)",
  "Object.isExtensible($)",
  "Object.isFrozen($)",
  "lengthOf($)",
  "lengthOf($)",
  "firstOf($)",
  "sizeOf($)",
  "xOf($)",
  "keysOf($)",
  "inherited($)",
  'String(typeof $ === "function" ? typeof $ : $)',
  'String(typeof $ === "function" ? typeof $ : $ + "")',
  "$ == 0",
  "structuredClone($)",
  "Object.freeze($).length",
  "Object.getPrototypeOf(Object.getPrototypeOf($)) === Object.prototype",
];

const prelude = (typed: boolean, isShownOutOfSight: boolean) => {
  const any = typed ? ": any" : "";
  const text = typed ? ": string" : "";
  return `${isShownOutOfSight ? `process.on("unhandledRejection", (error${any}) => show(construct(error, [lengthOf(error), firstOf(error), sizeOf(error), xOf(error)], error)));\n` : ""}const anchor = {};
let isLoud = true;
let notes${typed ? ": string[]" : ""} = [];
function note(line${text})${typed ? ": void" : ""} {
  if (isLoud) notes.push(line);
}
function say(line${text})${typed ? ": void" : ""} {
  if (!isLoud) return;
  console.log(line + (notes.length ? " (" + notes.join(", ") + ")" : ""));
  notes = [];
}
const hidden = ["stack", "line", "column", "sourceURL", "originalLine", "originalColumn"];
function named(keys${typed ? ": (string | symbol)[]" : ""})${text} {
  return keys.map(String).filter(key => !hidden.includes(key)).join();
}
function show(value${any}, depth${typed ? ": number" : ""} = 0)${text} {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + String(value.name);
  if (typeof value === "bigint") return value + "n";
  if (Object.is(value, -0)) return "-0";
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 1) return "..";
  const above = Object.getPrototypeOf(value);
  const name = above === null ? "null" : typeof above.constructor === "function" ? String(above.constructor.name) : "?";
  if (Array.isArray(value)) return name + "[" + Array.from(value, each => show(each, depth + 1)).join(", ") + "]";
  return (
    name +
    "{" +
    Reflect.ownKeys(value)
      .filter(key => !hidden.includes(String(key)))
      .map(key => {
        const described = Reflect.getOwnPropertyDescriptor(value, key)${typed ? "!" : ""};
        return String(key) + ": " + ("value" in described ? show(described.value, depth + 1) : "accessor");
      })
      .join(", ") +
    "}"
  );
}
function kindOf(error${any})${text} {
  return error instanceof Error ? error.constructor.name : typeof error;
}
function lengthOf(o${any})${any} {
  return o.length;
}
function firstOf(o${any})${any} {
  return o[0];
}
function sizeOf(o${any})${any} {
  return o.size;
}
function xOf(o${any})${any} {
  return o.x;
}
function keysOf(o${any})${text} {
  let keys = "";
  for (const key in o) keys += key + ",";
  return keys;
}
function inherited(o${any})${text} {
  let names = "";
  for (let above = Object.getPrototypeOf(o); above !== null; above = Object.getPrototypeOf(above))
    names += (Object.hasOwn(above, "constructor") && typeof above.constructor === "function" ? above.constructor.name : "?") + ">";
  return names;
}
function construct(maker${any}, given${typed ? ": any[]" : ""}, target${any})${any} {
  return Reflect.construct(maker, given, target);
}
function constructPlainly(maker${any}, ...given${typed ? ": any[]" : ""})${any} {
  return new maker(...given);
}`;
};

type Entity = {
  /** How the program names it. */
  name: string;
  arguments: string[];
  /** A class that a type annotation can name, and what may be asked of that type. */
  declared?: string[];
  runsText?: boolean;
};

function declare(random: Random, typed: boolean, index: number, known: Entity[]): { text: string; entity: Entity } {
  const any = typed ? ": any" : "";
  const self = typed ? "this: any, " : "";
  const selfAlone = typed ? "this: any" : "";
  const cast = (name: string) => (typed ? `(${name} as any)` : name);
  const other = () => random.pick(known).name;
  const wrapped = (text: string) => (typed ? `(${text} as any)` : `(${text})`);
  const plain = (name: string, text: string, given = ["1", "2.5", `"a"`, ""]) => ({
    text,
    entity: { name, arguments: given },
  });
  const kind = random.below(33);
  const name = (stem: string) => `${stem}${index}`;
  switch (kind) {
    case 0:
    case 1:
      return plain(name("Stores"), `function ${name("Stores")}(${self}a${any}) {\n  this.x = a;\n  this.y = "y";\n}`);
    case 2:
      return plain(name("stores"), `var ${name("stores")} = function (${self}a${any}) {\n  this.x = a;\n};`);
    case 3:
      return plain(
        name("StoresLength"),
        `function ${name("StoresLength")}(${self}a${any}) {\n  this[0] = a;\n  this[1] = 1.5;\n  this.length = 2;\n}`,
      );
    case 4:
      return plain(
        name("StoresSize"),
        `function ${name("StoresSize")}(${self}a${any}) {\n  this.size = a;\n  this.byteLength = 3;\n  this.message = "stored";\n}`,
      );
    case 5:
      return plain(
        name("Returns"),
        `function ${name("Returns")}(${self}a${any}) {\n  this.x = a;\n  return { made: a };\n}`,
      );
    case 6:
      return plain(name("ReturnsList"), `function ${name("ReturnsList")}(a${any}) {\n  return [a, 2];\n}`);
    case 7:
      return plain(
        name("ReturnsNumber"),
        `function ${name("ReturnsNumber")}(${self}a${any}) {\n  this.x = a;\n  return 5;\n}`,
      );
    case 8:
      return plain(
        name("Asks"),
        `function ${name("Asks")}(${selfAlone}) {\n  this.by = new.target === undefined ? "nobody" : ${cast("new.target")}.name;\n}`,
      );
    case 9:
      return plain(name("Empty"), `function ${name("Empty")}() {}`);
    case 10:
      return plain(name("Pushes"), `function ${name("Pushes")}(${self}a${any}) {\n  this.push(a);\n  this.push(2);\n}`);
    case 11:
      return plain(
        name("Hands"),
        `function ${name("Hands")}(a${any}) {\n  return Reflect.construct(${other()}, [a], new.target ?? Object);\n}`,
      );
    case 12:
      return plain(name("arrow"), `const ${name("arrow")} = (a${any}) => ({ a });`);
    case 13:
      return plain(
        `${name("holder")}.${random.pick(["method", "later", "steps"])}`,
        `const ${name("holder")} = {\n  method(a${any}) {\n    return { a };\n  },\n  async later() {},\n  *steps() {},\n};`,
      );
    case 14:
    case 15: {
      const own = name("Own");
      return {
        text: `class ${own} {
  x${typed ? ": number" : ""};
  y = "y";
  #secret = 4;
  constructor(a${any}) {
    this.x = a;
  }
  total()${typed ? ": number" : ""} {
    return this.x + this.y.length;
  }
  get double()${typed ? ": number" : ""} {
    return this.x * 2;
  }
  reveal()${typed ? ": number" : ""} {
    return this.#secret;
  }
}`,
        entity: {
          name: own,
          arguments: ["1", "2.5"],
          declared: ["$.x", "$.y", "$.total()", "$.double", "$.reveal()", "($.x = 8)", "($.x += 0.5)"],
        },
      };
    }
    case 16:
    case 17: {
      const above = known.filter(each => each.declared && each.name.startsWith("Own"));
      if (!above.length) return declare(random, typed, index, known);
      const parent = random.pick(above);
      const heir = name("Heir");
      return {
        text: `class ${heir} extends ${parent.name} {
  z = 3.5;
  w${typed ? ": number[]" : ""} = [1];
  total()${typed ? ": number" : ""} {
    return super.total() + this.z + this.w.length;
  }
}`,
        entity: {
          name: heir,
          arguments: ["1", "2.5"],
          declared: [...parent.declared!, "$.z", "$.w.length", "$.w[0]", "($.z = 1)"],
        },
      };
    }
    case 18:
      return plain(
        name("Null"),
        `class ${name("Null")} extends null {\n  constructor() {\n    return Object.create(new.target.prototype);\n  }\n}`,
        [""],
      );
    case 19:
      return plain(
        name("Old"),
        `function ${name("Old")}(${selfAlone}) {\n  Array.call(this);\n  this.x = 1;\n}\n${name("Old")}.prototype = Object.create(Array.prototype);`,
      );
    case 20: {
      const replaced = random.pick([
        "[]",
        "new Map()",
        "null",
        "5",
        "Array.prototype",
        "Uint8Array.prototype",
        'new Error("above")',
        "Object.create(null)",
        "Map.prototype",
      ]);
      return plain(
        name("Replaced"),
        `function ${name("Replaced")}(${self}a${any}) {\n  this.x = a;\n}\n${name("Replaced")}.prototype = ${replaced};`,
      );
    }
    case 22: {
      const over = name("Over");
      return {
        text: `class ${over} extends ${wrapped(`function (${self}a${any}) {\n  this.x = a;\n  return ${random.pick(["{ made: a }", "[a, 2.5]", "new Map([[1, a]])", "anchor", "Object.create(null)", "function () {}"])};\n}`)} {
  w = 1;
  #mark = 2;
  static isMarked(o${any})${typed ? ": boolean" : ""} {
    return #mark in o;
  }
}`,
        entity: { name: over, arguments: ["1", "2.5"] },
      };
    }
    case 23: {
      const judge = name("Judge");
      return {
        text: `class ${judge} {
  x = 1;
  static [Symbol.hasInstance](o${any})${typed ? ": boolean" : ""} {
    note("asked");
    return o !== null && typeof o === "object" && ${random.pick([`"x" in o`, `"length" in o`, "Array.isArray(o)", "false", "true"])};
  }
}`,
        entity: { name: judge, arguments: [""], declared: ["$.x", "($.x += 1)"] },
      };
    }
    case 21: {
      const base = random.pick(bases);
      return { text: "", entity: { name: base.name, arguments: base.arguments, runsText: base.name === "Function" } };
    }
    default: {
      const base = random.pick(random.chance(0.4) ? bases.slice(0, 1) : bases);
      const below = name(`Below${base.name}`);
      const parent = typed ? (base.type ?? base.name) : base.name;
      const given = random.pick(base.arguments);
      const form = random.below(7);
      const species = () =>
        `  static get [Symbol.species]()${any} {\n    return ${random.pick([base.name, "Array", "Object", ...known.filter(each => !each.runsText).map(each => each.name)])};\n  }\n`;
      const between =
        form === 5
          ? `class ${name("Between")} extends ${parent} {\n  depth()${typed ? ": number" : ""} {\n    return 1;\n  }\n}\n`
          : "";
      const body =
        form === 0 || form === 5
          ? ""
          : form === 1
            ? `  tag${typed ? ": string" : ""} = "t";\n  count${typed ? ": number" : ""} = 1;\n`
            : form === 2
              ? `  tag${typed ? ": string" : ""};\n  constructor() {\n    super(${given});\n    this.tag = "c";\n  }\n`
              : form === 3
                ? species()
                : form === 4
                  ? `  tag${typed ? ": string" : ""} = "t";\n  total()${typed ? ": number" : ""} {\n    return this.tag.length;\n  }\n${species()}`
                  : `  constructor(...given${typed ? ": any[]" : ""}) {\n    super(...${typed ? "(given as [])" : "given"});\n    note("${below} for " + new.target.name);\n  }\n`;
      // A constructor of these takes at least one argument, which the type of an empty list does not give.
      if (
        form === 6 &&
        typed &&
        ["Promise", "DataView", "RegExp", "Uint8Array", "Float64Array", "ArrayBuffer"].includes(base.name)
      )
        return declare(random, typed, index, known);
      const fields =
        form === 1
          ? ["$.tag", "$.count", "($.count += 1)"]
          : form === 2
            ? ["$.tag"]
            : form === 4
              ? ["$.tag", "$.total()"]
              : [];
      return {
        text: `${between}class ${below} extends ${between ? name("Between") : parent} {\n${body}}`,
        entity: {
          name: below,
          arguments: form === 2 ? [""] : base.arguments,
          declared: [...base.reads, ...base.reads, ...fields, ...fields],
          runsText: base.name === "Function",
        },
      };
    }
  }
}

function wrap(random: Random, typed: boolean, name: string): string {
  const inner = typed ? `(${name} as any)` : name;
  const any = typed ? ": any" : "";
  return random.weighted([
    [12, name],
    [1, `${inner}.bind(null)`],
    [1, `new Proxy(${inner}, {})`],
    [
      1,
      `new Proxy(${inner}, {\n  construct(target${any}, given${any}, newTarget${any}) {\n    note("construct");\n    return Reflect.construct(target, given, newTarget);\n  },\n})`,
    ],
    [
      1,
      `new Proxy(${inner}, {\n  get(target${any}, key${any}, receiver${any}) {\n    if (key === "prototype") note("prototype");\n    return Reflect.get(target, key, receiver);\n  },\n})`,
    ],
  ]);
}

function scene(random: Random, typed: boolean, index: number, entities: Entity[]): string {
  const any = typed ? ": any" : "";
  const cast = (name: string) => (typed ? `(${name} as any)` : /^\w+$/.test(name) ? name : `(${name})`);
  const maker = random.pick(entities);
  const target = random.pick(entities);
  const third = random.pick(entities);
  const M = wrap(random, typed, maker.name);
  const N = wrap(random, typed, target.name);
  const given = random.pick(maker.arguments);
  // What the object is meant to be an instance of, where a type says so.
  let meant: Entity = target;
  // Where only a built-in function constructs what runs text, an executable refuses the text, as documented.
  const seen = maker.runsText ? 0 : 1;
  const way = random.weighted<() => string>([
    [2, () => ((meant = maker), `new ${cast(M)}(${given})`)],
    [1, () => ((meant = maker), `Reflect.construct(${M}, [${given}])`)],
    [8, () => `Reflect.construct(${M}, [${given}], ${N})`],
    [3, () => `construct(${M}, [${given}], ${N})`],
    [1, () => ((meant = maker), `constructPlainly(${M}${given ? ", " + given : ""})`)],
    [2, () => ((meant = maker), `new (class extends ${cast(M)} {\n  constructor() {\n    super(${given});\n  }\n})()`)],
    [
      2,
      () =>
        `Reflect.construct(\n  class extends ${cast(M)} {\n    constructor() {\n      super(${given});\n    }\n  },\n  [],\n  ${N},\n)`,
    ],
    [
      2,
      () =>
        `Reflect.construct(\n  function () {\n    return Reflect.construct(${M}, [${given}], new.target${typed ? "!" : ""});\n  },\n  [],\n  ${N},\n)`,
    ],
    [
      2,
      () =>
        `((made${any}) => (${cast(M)}.call(made${given ? ", " + given : ""}), made))(Object.create(${cast(N)}.prototype))`,
    ],
    [1, () => `((made${any}) => (${cast(M)}.apply(made, [${given}]), made))(Object.create(${cast(N)}.prototype))`],
    [1, () => `((made${any}) => (Reflect.apply(${M}, made, [${given}]), made))(Object.create(${cast(N)}.prototype))`],
    [1, () => `Reflect.construct(${cast(M)}.bind(null), [${given}], ${N})`],
    [1, () => `Reflect.construct(${M}, [${given}], ${cast(N)}.bind(null))`],
    [
      1,
      () => ((meant = maker), `${cast(maker.name.includes("Date") ? "Array.of" : "Array.from")}.call(${M}, [1, 2.5])`),
    ],
    [seen, () => ((meant = maker), `${cast("Array.of")}.call(${M}, 1, 2)`)],
    [2, () => `Object.setPrototypeOf(new ${cast(M)}(${given}), ${cast(N)}.prototype)`],
    [1, () => `Object.create(${cast(N)}.prototype)`],
    [1, () => `({ __proto__: ${cast(N)}.prototype, x: 1, length: 2 })`],
    [1, () => `Object.assign(Object.create(${cast(N)}.prototype), new ${cast(M)}(${given}))`],
    [1, () => ((meant = maker), `${cast(M)}.from([1, 2.5])`)],
    [seen, () => ((meant = maker), `${cast(M)}.of(1, 2)`)],
    [seen, () => ((meant = maker), `${cast(M)}.resolve(1)`)],
    [
      seen,
      () => (
        (meant = maker),
        `((list${any}) => ((list.constructor = { [Symbol.species]: ${M} }), list.map((each${any}) => each)))([1, 2, 3])`
      ),
    ],
    [
      seen,
      () => (
        (meant = maker),
        `((list${any}) => ((list.constructor = { [Symbol.species]: ${M} }), list.slice(1)))(new ${cast(N)}(${random.pick(target.arguments)}))`
      ),
    ],
  ])();
  const relations = [
    `$ instanceof ${cast(maker.name)}`,
    `$ instanceof ${cast(target.name)}`,
    `$ instanceof ${cast(target.name)}`,
    `$ instanceof ${cast(third.name)}`,
    `Object.getPrototypeOf($) === ${cast(target.name)}.prototype`,
    `Object.getPrototypeOf($) === ${cast(maker.name)}.prototype`,
    `${cast(target.name)}.prototype.isPrototypeOf($)`,
    `$.constructor === ${target.name}`,
  ];
  const spelled = typed
    ? reads.map(read =>
        read.replaceAll("each =>", "(each: any) =>").replaceAll("Array.prototype.", "(Array.prototype as any)."),
      )
    : reads;
  const asked = random.sample([...spelled, ...relations, ...relations], random.between(3, 9));
  const label = (read: string) => JSON.stringify(`${index} ${read.replaceAll("$", "o")}`);
  const attempt = (read: string, o: string) =>
    `try {\n  say(${label(read)} + " " + show(${read.replaceAll("$", o)}));\n} catch (error) {\n  say(${label(read)} + " throws " + kindOf(error));\n}`;
  const style = random.weighted([
    [4, "variable"],
    [3, "expression"],
    [1, "closure"],
    [typed && meant.declared ? 5 : 0, "declared"],
    [typed && meant.declared ? 2 : 0, "reader"],
  ]);
  const collects = random.chance(0.15) ? "Bun.gc(true);\n" : "";
  let body: string;
  if (style === "expression")
    body = asked.map(read => attempt(read, `${typed ? "(" : ""}(${way})${typed ? " as any)" : ""}`)).join("\n");
  else {
    const typedReads =
      style === "declared" || style === "reader" ? random.sample(meant.declared!, random.between(2, 6)) : [];
    const rest = asked.map(read => attempt(read, style === "declared" ? "(o as any)" : "o")).join("\n");
    const first =
      style === "declared"
        ? typedReads.map(read => attempt(read, "o")).join("\n") + "\n"
        : style === "reader"
          ? `try {\n  say("${index} read " + read${index}(o));\n} catch (error) {\n  say("${index} read throws " + kindOf(error));\n}\n`
          : "";
    const reader =
      style === "reader"
        ? `function read${index}(o: ${meant.name}): string {\n  return [${typedReads.map(read => read.replaceAll("$", "o")).join(", ")}].map(each => show(each)).join(" ");\n}\n`
        : "";
    const use =
      style === "closure"
        ? `const look = () => {\n${rest}\n};\nlook();`
        : random.chance(0.5)
          ? first + rest
          : rest + "\n" + first;
    body = `${reader}let o${style === "declared" ? `: ${meant.name}` : any};\ntry {\n  o = ${typed ? `(${way}) as any` : way};\n} catch (error) {\n  say("${index} refused " + kindOf(error));\n  return;\n}\n${collects}${use}`;
  }
  const turns = random.chance(0.35) ? (maker.runsText || target.runsText ? 100 : 2000) : 1;
  const run =
    turns === 1
      ? `scene${index}();`
      : `for (let turn = 0; turn < ${turns}; turn++) {\n  isLoud = turn === 0 || turn === ${turns - 1};\n  scene${index}();\n}\nisLoud = true;`;
  return `function scene${index}()${typed ? ": void" : ""} {\n${body}\n}\n${run}`;
}

export function generate(random: Random, typed: boolean): string {
  const entities: Entity[] = [
    { name: "Array", arguments: bases[0].arguments },
    { name: "Object", arguments: [""] },
  ];
  const declarations: string[] = [];
  const isShownOutOfSight = random.chance(0.4);
  const count = random.between(3, 7);
  for (let index = 0; index < count; index++) {
    const { text, entity } = declare(random, typed, index, entities);
    if (entities.some(each => each.name === entity.name)) continue;
    if (text) declarations.push(text);
    entities.push(entity);
  }
  // A class gets another class above it before anything is constructed.
  const classes = entities.filter(each => each.declared);
  if (classes.length && random.chance(0.2)) {
    const below = random.pick(classes).name;
    const above = random.pick(entities).name;
    const part = random.pick(["", ".prototype", ".prototype"]);
    declarations.push(
      `try {\n  Object.setPrototypeOf(${below}${part}, ${typed && part ? `(${above} as any)` : above}${part});\n} catch (error) {\n  say("stays below " + kindOf(error));\n}`,
    );
  }
  const scenes = Array.from({ length: random.between(2, 6) }, (_, index) => scene(random, typed, index, entities));
  return [prelude(typed, isShownOutOfSight), ...declarations, ...scenes, "export {};"].join("\n") + "\n";
}
