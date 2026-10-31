// Programs of native-callbacks, models-*.js. `bun test/aot/generate.ts native-callbacks <where>` writes them.
// Every built-in whose row of the table of built-ins has a model written in TypeScript (Array.prototype.flat, Object.groupBy | entries | fromEntries, Object.prototype.toLocaleString, the four collection constructors,
// Iterator.prototype.forEach | toArray) with the program's own code on PLAIN objects in each place where native code may call it: getters, valueOf | toString | Symbol.toPrimitive, Symbol.iterator, next | return,
// the adder of a subclass, the species constructor, the traps of a proxy. ONE PLACE A PROGRAM. Each place twice where it is a function that can be called by hand: alone (nothing but native code reaches it: is it left out?)
// and beside an honest call with another receiver and another argument (is a proof made from the honest call alone?). No stored outputs: plain Bun is the reference.
import { programsOf, type WrittenProgram } from "../generate";

/** By the path below the folder of programs. */
const filesWritten: Record<string, string> = {};

const ITEM = `class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const log = [];
`;
const written: any[] = [];
function write(name: string, head: string, body: string) {
  if (written.includes(name)) throw new Error(name);
  written.push(name);
  filesWritten["models-" + name + ".js"] = "// " + head + "\n" + ITEM + body.replace(/^\n+|\n+$/g, "") + '\nconsole.log(log.join("\\n"));\n';
}

const STEP = "this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined }";
const OTHER = "{ index: 0.5, tag: 7 }";

// The places of something that is iterated: name -> (what it says, the code that makes `source` (the iterable) and `steps` (the iterator), the honest call or None)
function iterated(closes: any) {
  const places: Record<string, [string, string, string | undefined]> = {
    "the-iterator-method-of-a-plain-object": [
      "the Symbol.iterator method of a plain object", `
const source = {
  tag: "source",
  [Symbol.iterator](hint) {
    log.push("iterator " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
    return values[Symbol.iterator]();
  },
};`,
      "source[Symbol.iterator].call({ tag: 7 }, 1);",
    ],
    "a-getter-of-the-iterator-method": [
      "a getter under Symbol.iterator of a plain object, and the function it answers with", `
const source = {
  get [Symbol.iterator]() {
    log.push("get iterator " + (this === source));
    return function (hint) {
      log.push("iterator " + (this === source) + " " + typeof hint);
      return values[Symbol.iterator]();
    };
  },
};`,
      undefined,
    ],
    "next-of-a-plain-object": [
      "the next method of a plain object", `
const steps = {
  index: 0,
  tag: "steps",
  next(hint) {
    log.push("next " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
    return ` + STEP + `;
  },
};
const source = { [Symbol.iterator]: () => steps };`,
      "steps.next.call(" + OTHER + ", 1);",
    ],
    "a-getter-of-next": [
      "a getter under the name next of a plain object, and the function it answers with", `
const steps = {
  index: 0,
  get next() {
    log.push("get next " + (this === steps));
    return function (hint) {
      log.push("next " + (this === steps) + " " + typeof hint);
      return ` + STEP + `;
    };
  },
};
const source = { [Symbol.iterator]: () => steps };`,
      undefined,
    ],
    "a-getter-of-done": [
      "a getter under the name done of each result", `
const steps = {
  index: 0,
  next() {
    const at = this.index++;
    const result = {
      get done() {
        log.push("get done " + (this === result) + " " + at);
        return at >= values.length;
      },
      value: values[at],
    };
    return result;
  },
};
const source = { [Symbol.iterator]: () => steps };`,
      undefined,
    ],
    "a-getter-of-value": [
      "a getter under the name value of each result", `
const steps = {
  index: 0,
  next() {
    const at = this.index++;
    const result = {
      done: at >= values.length,
      get value() {
        log.push("get value " + (this === result) + " " + at);
        return values[at];
      },
    };
    return result;
  },
};
const source = { [Symbol.iterator]: () => steps };`,
      undefined,
    ],
    "next-inherited-from-a-plain-object": [
      "a next method that the iterator inherits from a plain object", `
const base = {
  tag: "base",
  next(hint) {
    log.push("next " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
    return ` + STEP + `;
  },
};
const steps = { __proto__: base, index: 0 };
const source = { [Symbol.iterator]: () => steps };`,
      "base.next.call(" + OTHER + ", 1);",
    ],
    "next-of-an-instance-of-a-class": [
      "the Symbol.iterator and next methods of two classes of the program", `
class Steps {
  index = 0;
  tag = "steps";
  next(hint) {
    log.push("next " + (this instanceof Steps) + " " + typeof hint + " " + (this.tag + 1));
    return ` + STEP + `;
  }
}
class Source {
  [Symbol.iterator](hint) {
    log.push("iterator " + (this === source) + " " + typeof hint);
    return new Steps();
  }
}
const source = new Source();`,
      "Steps.prototype.next.call(" + OTHER + ", 1);",
    ],
    "the-get-trap-of-a-proxy-of-the-list": [
      "the get trap of a proxy around the list", `
const source = new Proxy(values, {
  get(target, key, receiver) {
    log.push("get " + String(key) + " " + (receiver === source) + " " + arguments.length);
    return Reflect.get(target, key, receiver);
  },
});`,
      undefined,
    ],
    "the-get-trap-of-a-proxy-of-each-result": [
      "the get trap of a proxy around each result", `
const steps = {
  index: 0,
  next() {
    return new Proxy(` + STEP + `, {
      get(target, key) {
        log.push("get " + String(key) + " " + arguments.length);
        return target[key];
      },
    });
  },
};
const source = { [Symbol.iterator]: () => steps };`,
      undefined,
    ],
    "a-generator-function": [
      "the body of a generator function", `
function* walk(hint) {
  log.push("starts " + typeof hint);
  try {
    for (const value of values) yield value;
  } finally {
    log.push("ends");
  }
}
const source = { [Symbol.iterator]: walk };`,
      "walk(1).next();",
    ],
  };
  places["the-iterator-method-that-a-plain-object-inherits"] = [
    "the Symbol.iterator method that a plain object inherits from another", `
const source = {
  __proto__: {
    tag: "above",
    [Symbol.iterator](hint) {
      log.push("iterator " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
      return values[Symbol.iterator]();
    },
  },
};`,
    "source[Symbol.iterator].call({ tag: 7 }, 1);",
  ];
  places["reads-done-and-value-that-each-result-inherits"] = [
    "reads done and value of each result; here each result is an empty object that inherits both from a plain object", `
const steps = {
  index: 0,
  next() {
    log.push("next " + this.index);
    return { __proto__: ` + STEP + ` };
  },
};
const source = { [Symbol.iterator]: () => steps };`,
    undefined,
  ];
  places["getters-of-done-and-value-of-a-class"] = [
    "the getters done and value of a class of the program, of which each result is an instance", `
class Result {
  constructor(at) {
    this.at = at;
  }
  get done() {
    log.push("get done " + this.at);
    return this.at >= values.length;
  }
  get value() {
    log.push("get value " + this.at);
    return values[this.at];
  }
}
const steps = {
  index: 0,
  next() {
    return new Result(this.index++);
  },
};
const source = { [Symbol.iterator]: () => steps };`,
    undefined,
  ];
  if (closes) {
    places["return-that-a-plain-object-inherits"] = [
      "the return method that the iterator inherits from a plain object, when the walk ends early", `
const steps = {
  __proto__: {
    tag: "above",
    return(hint) {
      log.push("return " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
      return {};
    },
  },
  index: 0,
  next() {
    return ` + STEP + `;
  },
};
const source = { [Symbol.iterator]: () => steps };`,
      "steps.return.call(" + OTHER + ", 1);",
    ];
    places["return-of-a-plain-object"] = [
      "the return method of a plain object, when the walk ends early", `
const steps = {
  index: 0,
  tag: "steps",
  next() {
    return ` + STEP + `;
  },
  return(hint) {
    log.push("return " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
    return {};
  },
};
const source = { [Symbol.iterator]: () => steps };`,
      "steps.return.call(" + OTHER + ", 1);",
    ];
    places["a-getter-of-return"] = [
      "a getter under the name return of a plain object, when the walk ends early", `
const steps = {
  index: 0,
  next() {
    return ` + STEP + `;
  },
  get return() {
    log.push("get return " + (this === steps));
    return function (hint) {
      log.push("return " + (this === steps) + " " + typeof hint);
      return {};
    };
  },
};
const source = { [Symbol.iterator]: () => steps };`,
      undefined,
    ];
  }
  return places;
}

function attempt(call: string, show: string) {
  return "try {\n  const result = " + call + ";\n  console.log(" + show + ');\n} catch (error) {\n  console.log("threw " + error.constructor.name + ": " + error.message);\n}';
}

// The built-ins that walk what they are given: name -> (how the text names it, the values, the values of a walk that ends early, the call, what is shown)
const KEYS = 'const keyA = { name: "a" };\nconst keyB = { name: "b" };\n';
const WALKERS: Record<string, [string, string, string | undefined, string, string, string]> = {
  map: ["new Map(..)", '[["a", 1.5], ["b", item], [item, "two"]]', '[["a", 1.5], 5, ["b", item]]', "new Map(source)", 'result.size, [...result.keys()].map(key => typeof key).join(), result.get("b").double(), result.get("a") + 1', ""],
  "weak-map": ["new WeakMap(..)", "[[keyA, 1.5], [keyB, item]]", '[[keyA, 1.5], ["text", 2], [keyB, item]]', "new WeakMap(source)", "result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1", KEYS],
  set: ["new Set(..)", '[1.5, item, "two"]', undefined, "new Set(source)", "result.size, [...result].map(value => typeof value).join(), [...result][1].double()", ""],
  "weak-set": ["new WeakSet(..)", "[keyA, item]", '[keyA, "text", item]', "new WeakSet(source)", "result.has(keyA), result.has(item), result.has(keyB)", KEYS],
  "object-from-entries": ["Object.fromEntries", '[["a", 1.5], ["b", item], ["c", "two"]]', '[["a", 1.5], 5, ["b", item]]', "Object.fromEntries(source)", "Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1", ""],
  "object-group-by": ["Object.groupBy", '[1.5, item, "two", 2.5]', "[1.5, null, item]", 'Object.groupBy(source, value => {\n    if (value === null) throw new RangeError("no kind");\n    return typeof value;\n  })', "Object.keys(result).join(), result.object[0].double(), result.number[1] + 1", ""],
};
for (const [builtin, [text, values, early, call, show, more]] of Object.entries(WALKERS)) {
  for (const [place, [says, code, honest]] of Object.entries(iterated(early !== undefined))) {
    const ends = place.includes("return");
    const body = more + "const values = " + (ends ? early : values) + ";" + code + "\n";
    if (place.startsWith("reads-")) {
      write(builtin + "-" + place, text + " " + says + ".", body + attempt(call, show));
      continue;
    }
    write(builtin + "-runs-" + place, text + " runs " + says + ". Nothing else in the program reaches that code.", body + attempt(call, show));
    if (honest) {
      write(builtin + "-runs-" + place + "-beside-an-honest-call", text + " runs " + says + ", which the program itself calls once with another receiver and with a number.", body + honest + "\nlog.length = 0;\n" + (code.includes("const steps = {") ? "steps.index = 0;\n" : "") + attempt(call, show));
    }
  }
}

// The members of an entry, and the keys.
for (const builtin of ["map", "weak-map", "object-from-entries"]) {
  const [text, values, early, call, show, more] = WALKERS[builtin];
  const [first, second] = builtin === "weak-map" ? ["keyA", "keyB"] : ['"a"', '"b"'];
  let extra;
  for (const [member, other] of [["0", "1"], ["1", "0"]]) {
    const entry = (key, value, n) => "{\n    get " + member + '() {\n      log.push("get ' + member + " of entry " + n + ' " + (this === source[' + n + "]));\n      return " + (member === "0" ? key : value) + ";\n    },\n    " + other + ": " + (member === "0" ? value : key) + ",\n  }";
    extra = builtin === "weak-map" ? "" : ",\n  " + (builtin === "map" ? '[item, "two"]' : '["c", "two"]');
    write(
      builtin + "-reads-a-getter-under-" + member + "-of-a-plain-object-that-is-an-entry", text + " reads the members 0 and 1 of each entry; here an entry is a plain object and its member " + member + " is a getter.",
      more + "const source = [\n  " + entry(first, "1.5", "0") + ",\n  " + entry(second, "item", "1") + extra + ",\n];\n" + attempt(call, show),
    );
  }
  extra = builtin === "weak-map" ? "" : ", " + (builtin === "map" ? '[item, "two"]' : '["c", "two"]');
  write(
    builtin + "-reads-the-members-that-an-entry-inherits-from-a-plain-object", text + " reads the members 0 and 1 of each entry; here an entry is an empty object that inherits both from a plain object.",
    more + "const source = [{ __proto__: { 0: " + first + ", 1: 1.5 } }, { __proto__: { 0: " + second + ", 1: item } }" + extra + "];\n" + attempt(call, show),
  );
  write(
    builtin + "-reads-getters-that-an-entry-inherits-from-a-plain-object", text + " reads the members 0 and 1 of each entry; here an entry inherits two getters from a plain object.",
    more + 'const above = {\n  get 0() {\n    log.push("get 0 " + typeof this.held);\n    return this.name;\n  },\n  get 1() {\n    log.push("get 1 " + typeof this.held);\n    return this.held;\n  },\n};\nconst source = [{ __proto__: above, name: ' + first + ", held: 1.5 }, { __proto__: above, name: " + second + ", held: item }" + extra + "];\n" + attempt(call, show),
  );
  write(
    builtin + "-reads-getters-of-a-class-whose-instances-are-the-entries", text + " reads the members 0 and 1 of each entry; here the entries are instances of a class that has two getters under those names.",
    more + 'class Pair {\n  constructor(name, held) {\n    this.name = name;\n    this.held = held;\n  }\n  get 0() {\n    log.push("get 0 " + typeof this.held);\n    return this.name;\n  }\n  get 1() {\n    log.push("get 1 " + typeof this.held);\n    return this.held;\n  }\n}\nconst source = [new Pair(' + first + ", 1.5), new Pair(" + second + ", item)" + extra + "];\n" + attempt(call, show),
  );
  write(
    builtin + "-reads-an-entry-through-the-get-trap-of-a-proxy", text + " reads the members 0 and 1 of each entry; here each entry is a proxy.",
    more + "const values = " + values + ';\nconst source = values.map(entry => new Proxy(entry, {\n  get(target, key) {\n    log.push("get " + String(key) + " " + arguments.length);\n    return target[key];\n  },\n}));\n' + attempt(call, show),
  );
}

const CONVERSIONS: Record<string, [string, string, string | undefined]> = {
  "to-string": ["toString", '{\n  tag: "key",\n  toString(hint) {\n    log.push("toString " + (this === key) + " " + typeof hint + " " + (this.tag + 1));\n    return "b";\n  },\n}', "key.toString.call({ tag: 7 }, 1);"],
  "value-of": ["valueOf, for it has no toString", '{\n  __proto__: null,\n  tag: "key",\n  valueOf(hint) {\n    log.push("valueOf " + (this === key) + " " + typeof hint + " " + (this.tag + 1));\n    return "b";\n  },\n}', "key.valueOf.call({ tag: 7 }, 1);"],
  "to-primitive": ["Symbol.toPrimitive", '{\n  tag: "key",\n  [Symbol.toPrimitive](hint) {\n    log.push("toPrimitive " + (this === key) + " " + hint + " " + (this.tag + 1));\n    return "b";\n  },\n}', "key[Symbol.toPrimitive].call({ tag: 7 }, 1);"],
  "value-of-after-to-string": ["toString, which answers with an object, and then valueOf", '{\n  toString() {\n    log.push("toString " + (this === key));\n    return {};\n  },\n  valueOf() {\n    log.push("valueOf " + (this === key));\n    return "b";\n  },\n}', undefined],
  "to-string-that-it-inherits": ["toString, which it inherits from another plain object", '{\n  __proto__: {\n    tag: "above",\n    toString(hint) {\n      log.push("toString " + (this === key) + " " + typeof hint + " " + (this.tag + 1));\n      return "b";\n    },\n  },\n}', "key.toString.call({ tag: 7 }, 1);"],
  "a-getter-of-to-string": ["a getter under the name toString, and the function it answers with", '{\n  get toString() {\n    log.push("get toString " + (this === key));\n    return function (hint) {\n      log.push("toString " + (this === key) + " " + typeof hint);\n      return "b";\n    };\n  },\n}', undefined],
};
for (const [name, [says, literal, honest]] of Object.entries(CONVERSIONS)) {
  for (const [builtin, call, show] of [
    ["object-from-entries", 'Object.fromEntries([["a", 1.5], [key, item]])', "Object.keys(result).join(), result.b.double(), result.a + 1"],
    ["object-group-by", 'Object.groupBy([1.5, item], value => (typeof value === "object" ? key : "a"))', "Object.keys(result).join(), result.b[0].double(), result.a[0] + 1"],
  ]) {
    const text = WALKERS[builtin][0];
    write(builtin + "-makes-a-key-by-" + name + "-of-a-plain-object", text + " turns a plain object into a property key by its " + says + ". Nothing else in the program reaches that code.", "const key = " + literal + ";\n" + attempt(call, show));
    if (honest) {
      write(
        builtin + "-makes-a-key-by-" + name + "-of-a-plain-object-beside-an-honest-call", text + " turns a plain object into a property key by its " + says + ", which the program itself calls once with another receiver and with a number.",
        "const key = " + literal + ";\n" + honest + "\nlog.length = 0;\n" + attempt(call, show),
      );
    }
  }
}

write(
  "object-group-by-runs-a-callback-with-the-value-and-the-index", "Object.groupBy runs its callback with the value and the index. Nothing else in the program reaches that code.",
  'function choose(value, index) {\n  log.push("choose " + typeof value + " " + index + " " + arguments.length + " " + (this === undefined));\n  return index % 2 ? "odd" : "even";\n}\n' + attempt('Object.groupBy([1.5, item, "two"], choose)', "Object.keys(result).join(), result.odd[0].double(), result.even[0] + 1"),
);
write(
  "object-group-by-runs-a-callback-beside-an-honest-call", "Object.groupBy runs its callback with the value and the index; the program itself calls it once with two texts.",
  'function choose(value, index) {\n  log.push("choose " + typeof value + " " + (index + 1) + " " + arguments.length);\n  return index % 2 ? "odd" : "even";\n}\nchoose("text", "text");\nlog.length = 0;\n' + attempt('Object.groupBy([1.5, item, "two"], choose)', "Object.keys(result).join(), result.odd[0].double(), result.even[0] + 1"),
);

// The adder of a subclass, and the object that is made for another new target.
for (const [builtin, base, adder, values, show, more] of [
  ["map", "Map", "set", '[["a", 1.5], ["b", item]]', 'result.size, result.get("b").double(), result instanceof Held', ""], ["weak-map", "WeakMap", "set", "[[keyA, 1.5], [keyB, item]]", "result.get(keyB).double(), result instanceof Held", KEYS],
  ["set", "Set", "add", "[1.5, item]", "result.size, [...result][1].double(), result instanceof Held", ""], ["weak-set", "WeakSet", "add", "[keyA, item]", "result.has(item), result instanceof Held", KEYS],
]) {
  const text = "new " + base + "(..)";
  const two = adder === "set";
  const [parameters, passed, types] = two ? ["key, value", "key, value", 'typeof key + " " + typeof value'] : ["value", "value", "typeof value"];
  const method = "  " + adder + "(" + parameters + ') {\n    log.push("' + adder + ' " + ' + types + ' + " " + arguments.length + " " + (this instanceof Held));\n    return super.' + adder + "(" + passed + ");\n  }\n";
  write(
    builtin + "-runs-the-adder-of-a-subclass", text + " in a subclass puts each value in by the method " + adder + " of the subclass. Nothing else in the program reaches that code.",
    more + "class Held extends " + base + " {\n" + method + "}\n" + attempt("new Held(" + values + ")", show),
  );
  write(
    builtin + "-runs-the-adder-of-a-subclass-beside-an-honest-call", text + " in a subclass puts each value in by the method " + adder + " of the subclass, which the program itself calls once with " + (builtin.includes("weak") ? "an object and a text" : "texts") + ".",
    more + "class Held extends " + base + " {\n" + method + "}\nnew Held()." + adder + "(" + ((builtin.includes("weak") ? "{}" : '"text"') + (two ? ', "text"' : "")) + ");\nlog.length = 0;\n" + attempt("new Held(" + values + ")", show),
  );
  write(
    builtin + "-runs-the-adder-that-a-subclass-inherits-from-a-class-in-the-middle", text + " in a subclass puts each value in by the method " + adder + " that the subclass inherits from another class of the program.",
    more + "class Middle extends " + base + " {\n" + method + "}\nclass Held extends Middle {}\n" + attempt("new Held(" + values + ")", show),
  );
  write(
    builtin + "-reads-a-getter-of-the-adder-of-a-subclass", text + " in a subclass reads the method " + adder + " once; here it is a getter of the subclass.",
    more + "class Held extends " + base + " {\n  get " + adder + '() {\n    log.push("get ' + adder + ' " + (this instanceof Held));\n    return function (' + parameters + ') {\n      log.push("' + adder + ' " + ' + types + ");\n      return " + base + ".prototype." + adder + ".call(this, " + passed + ");\n    };\n  }\n}\n" + attempt("new Held(" + values + ")", show),
  );
  write(
    builtin + "-closes-the-walk-when-the-adder-of-a-subclass-throws", text + " in a subclass runs the return method of the iterator when the method " + adder + " of the subclass throws.",
    more + "const values = " + values + ";\nclass Held extends " + base + " {\n  " + adder + "(" + parameters + ') {\n    log.push("' + adder + ' " + ' + types + ');\n    throw new RangeError("full");\n  }\n}\nconst steps = {\n  index: 0,\n  next() {\n    return ' + STEP + ';\n  },\n  return(hint) {\n    log.push("return " + (this === steps) + " " + typeof hint);\n    return {};\n  },\n};\n' + attempt("new Held({ [Symbol.iterator]: () => steps })", show),
  );
  write(
    builtin + "-made-by-reflect-construct-for-a-subclass-runs-its-adder", "Reflect.construct(" + base + ", .., a subclass) puts each value in by the method " + adder + " of the subclass.",
    more + "class Held extends " + base + " {\n" + method + "}\n" + attempt("Reflect.construct(" + base + ", [" + values + "], Held)", show),
  );
  write(
    builtin + "-made-for-a-function-whose-prototype-is-a-plain-object-runs-its-adder", "Reflect.construct(" + base + ", .., a function) puts each value in by the method " + adder + " of the plain object that is the prototype property of the function.",
    more + "function Held() {}\nHeld.prototype = {\n  __proto__: " + base + ".prototype,\n  " + adder + "(" + parameters + ') {\n    log.push("' + adder + ' " + ' + types + ' + " " + arguments.length + " " + (this instanceof Held));\n    return ' + base + ".prototype." + adder + ".call(this, " + passed + ");\n  },\n};\n" + attempt("Reflect.construct(" + base + ", [" + values + "], Held)", show),
  );
  write(
    builtin + "-made-for-a-proxy-reads-prototype-through-its-get-trap", "Reflect.construct(" + base + ", .., a proxy of a subclass) reads the prototype property through the get trap of the proxy.",
    more + "class Held extends " + base + " {\n" + method + '}\nconst target = new Proxy(Held, {\n  get(held, key) {\n    log.push("get " + String(key) + " " + arguments.length);\n    return held[key];\n  },\n});\n' + attempt("Reflect.construct(" + base + ", [" + values + "], target)", show),
  );
  write(
    builtin + "-made-for-a-bound-function-reads-a-getter-of-prototype", "Reflect.construct(" + base + ", .., a bound function) reads the prototype property of the bound function; here it is a getter.",
    more + "class Held extends " + base + " {\n" + method + '}\nconst target = Object.defineProperty(Held.bind(null), "prototype", {\n  get() {\n    log.push("get prototype " + (this === target));\n    return Held.prototype;\n  },\n});\n' + attempt("Reflect.construct(" + base + ", [" + values + "], target)", show),
  );
}

// Iterator.prototype.forEach | toArray: the receiver is the iterator.
function receivers() {
  const every = iterated(true);
  const keep = [
    "next-of-a-plain-object", "a-getter-of-next", "a-getter-of-done", "a-getter-of-value", "next-inherited-from-a-plain-object", "the-get-trap-of-a-proxy-of-each-result", "return-of-a-plain-object", "a-getter-of-return",
    "reads-done-and-value-that-each-result-inherits", "getters-of-done-and-value-of-a-class", "return-that-a-plain-object-inherits",
  ];
  return Object.fromEntries(keep.map(name => [name, every[name]]));
}
const HELPERS: Record<string, [string, string, string, string | undefined]> = {
  "iterator-for-each": [
    "Iterator.prototype.forEach", 'Iterator.prototype.forEach.call(steps, (value, index) => {\n    seen.push(typeof value + index);\n    if (typeof value === "object") seen.push(value.double());\n  })', "result, seen.join()",
    'Iterator.prototype.forEach.call(steps, value => {\n    if (typeof value === "object") throw new RangeError("enough");\n  })',
  ],
  "iterator-to-array": ["Iterator.prototype.toArray", "Iterator.prototype.toArray.call(steps)", "Array.isArray(result), result.length, result[0] + 1, result[1].double()", undefined],
};
for (const [builtin, [text, call, show, early]] of Object.entries(HELPERS)) {
  for (let [place, [says, code, honest]] of Object.entries(receivers())) {
    if (place.includes("return") && early === undefined) {
      continue;
    }
    code = code.replaceAll("\nconst source = { [Symbol.iterator]: () => steps };", "");
    const body = 'const values = [1.5, item, "two"];\nconst seen = [];' + code + "\n";
    const used = place.includes("return") ? early! : call;
    if (place.startsWith("reads-")) {
      write(builtin + "-" + place, text + " " + says + ".", body + attempt(used, show));
      continue;
    }
    write(builtin + "-runs-" + place + "-that-is-its-receiver", text + " runs " + says + ", its receiver. Nothing else in the program reaches that code.", body + attempt(used, show));
    if (honest) {
      write(builtin + "-runs-" + place + "-that-is-its-receiver-beside-an-honest-call", text + " runs " + says + ", its receiver, which the program itself calls once with another receiver and with a number.", body + honest + "\nlog.length = 0;\nsteps.index = 0;\n" + attempt(used, show));
    }
  }
  const plain = 'const values = [1.5, item, "two"];\nconst seen = [];\n';
  const member = builtin.slice(builtin.indexOf("-") + 1).replaceAll("for-each", "forEach").replaceAll("to-array", "toArray");
  const argument = member === "toArray" ? "" : '(value, index) => {\n    seen.push(typeof value + index);\n    if (typeof value === "object") seen.push(value.double());\n  }';
  const nextMethod = '  index: 0,\n  next(hint) {\n    log.push("next " + (this === steps) + " " + typeof hint);\n    return ' + STEP + ";\n  },\n";
  write(builtin + "-is-inherited-by-a-plain-object-with-a-next-method", text + " is found on a plain object whose prototype is Iterator.prototype, and runs its next method.", plain + "const steps = {\n  __proto__: Iterator.prototype,\n" + nextMethod + "};\n" + attempt("steps." + member + "(" + argument + ")", show));
  write(builtin + "-is-a-member-of-a-plain-object-with-a-next-method", text + " is stored as a member of a plain object, and runs its next method.", plain + "const steps = {\n  work: Iterator.prototype." + member + ",\n" + nextMethod + "};\n" + attempt("steps.work(" + argument + ")", show));
  write(builtin + "-is-applied-by-reflect-to-a-plain-object-with-a-next-method", text + " is applied by Reflect.apply to a plain object, and runs its next method.", plain + "const steps = {\n" + nextMethod + "};\n" + attempt("Reflect.apply(Iterator.prototype." + member + ", steps, [" + argument + "])", show));
  write(builtin + "-is-bound-to-a-plain-object-with-a-next-method", text + " is bound to a plain object, and runs its next method.", plain + "const steps = {\n" + nextMethod + "};\n" + attempt("Iterator.prototype." + member + ".bind(steps)(" + argument + ")", show));
  write(
    builtin + "-reads-next-through-the-get-trap-of-a-proxy-that-is-its-receiver", text + " reads next through the get trap of the proxy that is its receiver.",
    plain + 'const inner = {\n  index: 0,\n  next() {\n    return inner.index < values.length ? { done: false, value: values[inner.index++] } : { done: true, value: undefined };\n  },\n};\nconst steps = new Proxy(inner, {\n  get(target, key, receiver) {\n    log.push("get " + String(key) + " " + (receiver === steps));\n    return target[key];\n  },\n});\n' + attempt(call, show),
  );
}
write(
  "iterator-for-each-closes-a-plain-object-when-what-it-is-given-is-no-function", "Iterator.prototype.forEach is given a number in place of a function; whether it runs the return method of its receiver is for plain Bun to say.",
  'const values = [1.5];\nconst steps = {\n  index: 0,\n  next() {\n    log.push("next");\n    return ' + STEP + ';\n  },\n  return(hint) {\n    log.push("return " + (this === steps) + " " + typeof hint);\n    return {};\n  },\n};\n' + attempt("Iterator.prototype.forEach.call(steps, 5)", "result"),
);

// Array.prototype.flat
const FLAT = 'result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double()';
function flat(name: string, head: string, body: string, call = "Array.prototype.flat.call(source)", show = FLAT) {
  write("array-flat-" + name, "Array.prototype.flat " + head, body + "\n" + attempt(call, show));
}
flat("reads-a-getter-of-length-of-a-plain-object", "reads the length of a plain object; here it is a getter.", 'const source = {\n  0: 1.5,\n  1: [item, "two"],\n  get length() {\n    log.push("get length " + (this === source));\n    return 2;\n  },\n};');
for (const [name, [says, literal, honest]] of Object.entries({
  "value-of": ["valueOf", '{\n  tag: "count",\n  valueOf(hint) {\n    log.push("valueOf " + (this === count) + " " + typeof hint + " " + (this.tag + 1));\n    return 2;\n  },\n}', "count.valueOf.call({ tag: 7 }, 1);"],
  "to-string": ["toString, for its valueOf answers with an object", '{\n  valueOf() {\n    log.push("valueOf " + (this === count));\n    return {};\n  },\n  toString() {\n    log.push("toString " + (this === count));\n    return "2";\n  },\n}', undefined],
  "to-primitive": ["Symbol.toPrimitive", '{\n  tag: "count",\n  [Symbol.toPrimitive](hint) {\n    log.push("toPrimitive " + (this === count) + " " + hint + " " + (this.tag + 1));\n    return 2;\n  },\n}', "count[Symbol.toPrimitive].call({ tag: 7 }, 1);"],
})) {
  flat("turns-the-length-of-a-plain-object-into-a-number-by-" + name, "turns the length of a plain object into a number by its " + says + ".", "const count = " + literal + ';\nconst source = { 0: 1.5, 1: [item, "two"], length: count };');
  flat("turns-the-depth-into-a-number-by-" + name, "turns the depth it is given into a number by its " + says + ".", "const count = " + literal + ';\nconst source = [1.5, [[item, "two"]]];', "source.flat(count)");
  if (honest) {
    flat("turns-the-depth-into-a-number-by-" + name + "-beside-an-honest-call", "turns the depth it is given into a number by its " + says + ", which the program itself calls once with another receiver and with a number.", "const count = " + literal + ';\nconst source = [1.5, [[item, "two"]]];\n' + honest + "\nlog.length = 0;", "source.flat(count)");
  }
}
flat("reads-a-getter-under-an-index-of-a-plain-object", "reads the elements of a plain object; here one is a getter.", 'const source = {\n  0: 1.5,\n  get 1() {\n    log.push("get 1 " + (this === source));\n    return [item, "two"];\n  },\n  length: 2,\n};');
flat("reads-a-getter-under-an-index-that-a-plain-object-inherits", "reads the elements of a plain object; here one is a getter of the plain object above it.", 'const source = {\n  __proto__: {\n    get 1() {\n      log.push("get 1 " + (this === source));\n      return [item, "two"];\n    },\n  },\n  0: 1.5,\n  length: 2,\n};');
flat("reads-an-element-that-a-plain-object-inherits", "reads the elements of a plain object; here one stands in the plain object above it.", 'const source = { __proto__: { 1: [item, "two"] }, 0: 1.5, length: 2 };');
flat("reads-the-length-that-a-plain-object-inherits", "reads the length of a plain object; here it stands in the plain object above it.", 'const source = { __proto__: { length: 2 }, 0: 1.5, 1: [item, "two"] };');
flat("reads-a-getter-of-length-that-a-plain-object-inherits", "reads the length of a plain object; here it is a getter of the plain object above it.", 'const source = {\n  __proto__: {\n    get length() {\n      log.push("get length " + (this === source));\n      return 2;\n    },\n  },\n  0: 1.5,\n  1: [item, "two"],\n};');
flat("reads-an-element-that-an-array-with-a-hole-inherits", "reads the elements of an array; here the array has a hole, and the object that was made its prototype has an element there.", 'const source = [1.5, , "two"];\nObject.setPrototypeOf(source, { __proto__: Array.prototype, 1: [item] });', "source.flat()");
flat("reads-a-getter-that-an-array-with-a-hole-inherits", "reads the elements of an array; here the array has a hole, and the object that was made its prototype has a getter there.", 'const source = [1.5, , "two"];\nObject.setPrototypeOf(source, {\n  __proto__: Array.prototype,\n  get 1() {\n    log.push("get 1 " + (this === source));\n    return [item];\n  },\n});', "source.flat()");
flat("reads-an-element-that-an-inner-array-with-a-hole-inherits", "reads the elements of the arrays inside; here one of those has a hole, and the object that was made its prototype has an element there.", 'const inner = [, "two"];\nObject.setPrototypeOf(inner, { __proto__: Array.prototype, 0: item });\nconst source = [1.5, inner];', "source.flat()");
flat("reads-a-getter-under-an-index-of-an-array", "reads the elements of an array; here one was defined as a getter.", 'const source = [1.5, 0];\nObject.defineProperty(source, 1, {\n  get() {\n    log.push("get 1 " + (this === source));\n    return [item, "two"];\n  },\n});', "source.flat()");
flat("reads-a-getter-under-an-index-of-an-inner-array", "reads the elements of the arrays inside; here one of those was defined as a getter.", 'const inner = [0, "two"];\nObject.defineProperty(inner, 0, {\n  get() {\n    log.push("get 0 " + (this === inner));\n    return item;\n  },\n});\nconst source = [1.5, inner];', "source.flat()");
flat("reads-a-getter-of-constructor-of-an-array", "reads the constructor of the array; here it is a getter.", 'const source = [1.5, [item, "two"]];\nObject.defineProperty(source, "constructor", {\n  get() {\n    log.push("get constructor " + (this === source));\n    return Array;\n  },\n});', "source.flat()");
flat("reads-a-getter-of-species", "reads Symbol.species of the constructor of the array; here it is a getter of a plain object.", 'const source = [1.5, [item, "two"]];\nsource.constructor = {\n  get [Symbol.species]() {\n    log.push("get species " + (this === source.constructor));\n    return Array;\n  },\n};', "source.flat()");
flat("constructs-the-species-that-is-a-function-of-the-program", "makes its result by the function that stands under Symbol.species.", 'function Made(length) {\n  log.push("constructs " + typeof length + " " + arguments.length + " " + (new.target === Made));\n  return [];\n}\nconst source = [1.5, [item, "two"]];\nsource.constructor = { [Symbol.species]: Made };', "source.flat()");
flat("constructs-the-species-beside-an-honest-call", "makes its result by the function that stands under Symbol.species, which the program itself constructs once with a text.", 'function Made(length) {\n  log.push("constructs " + typeof length + " " + (length + 1) + " " + arguments.length);\n  return [];\n}\nnew Made("text");\nlog.length = 0;\nconst source = [1.5, [item, "two"]];\nsource.constructor = { [Symbol.species]: Made };', "source.flat()");
flat("constructs-a-subclass-of-array", "on an instance of a subclass of Array makes its result by the constructor of the subclass.", 'class List extends Array {\n  constructor(length) {\n    log.push("constructs " + typeof length + " " + arguments.length);\n    super(length);\n  }\n}\nconst source = List.from([1.5, [item, "two"]]);\nlog.length = 0;', "source.flat()", FLAT + ", result instanceof List");
flat("defines-its-elements-through-the-trap-of-a-proxy-made-by-the-species", "defines the elements of its result; here the species answers with a proxy.", 'const source = [1.5, [item, "two"]];\nsource.constructor = {\n  [Symbol.species]: function () {\n    return new Proxy([], {\n      defineProperty(target, key, descriptor) {\n        log.push("defines " + String(key) + " " + typeof descriptor.value);\n        return Reflect.defineProperty(target, key, descriptor);\n      },\n    });\n  },\n};', "source.flat()");
flat("asks-the-has-and-get-traps-of-a-proxy", "asks for each index and reads it; here the receiver is a proxy of an array.", 'const source = new Proxy([1.5, [item, "two"]], {\n  has(target, key) {\n    log.push("has " + String(key));\n    return key in target;\n  },\n  get(target, key, receiver) {\n    log.push("get " + String(key) + " " + (receiver === source));\n    return target[key];\n  },\n});');
flat("asks-the-traps-of-a-proxy-of-an-inner-array", "takes a proxy of an array for an array; here such a proxy stands inside.", 'const inner = new Proxy([item, "two"], {\n  has(target, key) {\n    log.push("has " + String(key));\n    return key in target;\n  },\n  get(target, key) {\n    log.push("get " + String(key));\n    return target[key];\n  },\n});\nconst source = [1.5, inner];', "source.flat()");

// Object.entries
const ENTRIES = 'result.map(entry => entry[0] + typeof entry[1]).join(), result.find(entry => typeof entry[1] === "object")[1].double()';
function entries(name: string, head: string, body: string) {
  write("object-entries-" + name, "Object.entries " + head, body + "\n" + attempt("Object.entries(source)", ENTRIES));
}
entries("reads-a-getter-of-a-plain-object", "reads each own property; here one is a getter written in the literal.", 'const source = {\n  a: 1.5,\n  get b() {\n    log.push("get b " + (this === source));\n    return item;\n  },\n  c: "two",\n};');
entries("reads-a-getter-that-was-defined-on-a-plain-object", "reads each own property; here one was defined as a getter.", 'function read(hint) {\n  log.push("get b " + (this === source) + " " + typeof hint);\n  return item;\n}\nconst source = { a: 1.5 };\nObject.defineProperty(source, "b", { get: read, enumerable: true });');
entries("reads-a-getter-that-was-defined-beside-an-honest-call", "reads each own property; here one was defined as a getter, and the program itself calls that function once with another receiver and with a number.", 'function read(hint) {\n  log.push("get b " + (this === source) + " " + typeof hint + " " + (this.a + 1));\n  return item;\n}\nconst source = { a: 1.5 };\nObject.defineProperty(source, "b", { get: read, enumerable: true });\nread.call({ a: "text" }, 1);\nlog.length = 0;');
entries("reads-a-getter-that-takes-a-later-property-away", "reads each own property; here a getter deletes the one behind it and adds another.", 'const source = {\n  get a() {\n    log.push("get a " + (this === source));\n    delete this.b;\n    this.d = 2.5;\n    return item;\n  },\n  b: 1.5,\n  c: "two",\n};');
entries("reads-a-getter-of-an-instance-of-a-class", "reads each own property; here an instance of a class has an own getter.", 'class Holder {\n  a = 1.5;\n  constructor() {\n    Object.defineProperty(this, "b", {\n      get() {\n        log.push("get b " + (this === source));\n        return item;\n      },\n      enumerable: true,\n    });\n  }\n}\nconst source = new Holder();');
entries("reads-a-getter-of-a-function", "reads each own property; here the object is a function with a getter.", 'const source = Object.defineProperty(function () {}, "b", {\n  get() {\n    log.push("get b " + (this === source));\n    return item;\n  },\n  enumerable: true,\n});');
entries("asks-the-own-keys-trap-of-a-proxy", "asks a proxy for its keys.", 'const source = new Proxy({ a: 1.5, b: item }, {\n  ownKeys(target) {\n    log.push("ownKeys " + arguments.length);\n    return Reflect.ownKeys(target);\n  },\n});');
entries("asks-the-descriptor-trap-of-a-proxy", "asks a proxy for the descriptor of each key.", 'const source = new Proxy({ a: 1.5, b: item }, {\n  getOwnPropertyDescriptor(target, key) {\n    log.push("descriptor " + String(key) + " " + arguments.length);\n    return Reflect.getOwnPropertyDescriptor(target, key);\n  },\n});');
entries("asks-the-get-trap-of-a-proxy", "reads each property of a proxy.", 'const source = new Proxy({ a: 1.5, b: item }, {\n  get(target, key, receiver) {\n    log.push("get " + String(key) + " " + (receiver === source));\n    return target[key];\n  },\n});');

// Object.prototype.toLocaleString
function locale(name: string, head: string, body: string, call = "source.toLocaleString()", show = "typeof result, result") {
  write("object-to-locale-string-" + name, "Object.prototype.toLocaleString " + head, body + "\n" + attempt(call, show));
}
const TOSTRING = '  tag: "source",\n  toString(hint) {\n    log.push("toString " + (this === source) + " " + typeof hint + " " + (this.tag + 1));\n    return "text " + item.double();\n  },\n';
locale("runs-to-string-of-a-plain-object", "runs the toString method of a plain object. Nothing else in the program reaches that code.", "const source = {\n" + TOSTRING + "};");
locale("runs-to-string-of-a-plain-object-beside-an-honest-call", "runs the toString method of a plain object, which the program itself calls once with another receiver and with a number.", "const source = {\n" + TOSTRING + "};\nsource.toString.call({ tag: 7 }, 1);\nlog.length = 0;");
locale("reads-a-getter-of-to-string", "reads toString; here it is a getter of a plain object.", 'const source = {\n  get toString() {\n    log.push("get toString " + (this === source));\n    return function (hint) {\n      log.push("toString " + (this === source) + " " + typeof hint);\n      return "text " + item.double();\n    };\n  },\n};');
locale("runs-to-string-that-a-plain-object-inherits", "runs the toString method that a plain object inherits from another.", "const source = {\n  __proto__: {\n  " + TOSTRING.replaceAll("\n  ", "\n    ").replace(/ +$/, "") + "  },\n};");
locale("runs-to-string-of-a-class", "runs the toString method of a class of the program.", 'class Holder {\n  tag = "source";\n  toString(hint) {\n    log.push("toString " + (this === source) + " " + typeof hint + " " + (this.tag + 1));\n    return "text " + item.double();\n  }\n}\nconst source = new Holder();');
locale("is-borrowed-for-an-object-without-a-prototype", "is called on an object that has no prototype and a toString method of its own.", "const source = {\n  __proto__: null,\n" + TOSTRING + "};", "Object.prototype.toLocaleString.call(source)");
locale("answers-with-whatever-to-string-answers", "answers with what toString answers, also when that is no text.", 'const source = {\n  toString() {\n    log.push("toString " + (this === source));\n    return item;\n  },\n};', undefined, "typeof result, result.double()");
locale("reads-to-string-through-the-get-trap-of-a-proxy", "reads toString through the get trap of a proxy.", 'const source = new Proxy({}, {\n  get(target, key, receiver) {\n    log.push("get " + String(key) + " " + (receiver === source));\n    return () => "text " + item.double();\n  },\n});', "Object.prototype.toLocaleString.call(source)");
locale("is-run-for-each-element-by-array-to-locale-string", "is what Array.prototype.toLocaleString runs for a plain object in the array, and it runs the toString method of that object.", "const source = {\n" + TOSTRING + "};", "[source, source].toLocaleString()");
locale("is-hidden-by-a-method-of-the-element", "is not what Array.prototype.toLocaleString runs for an element that has a toLocaleString method of its own.", 'const source = {\n  toLocaleString(locales, options) {\n    log.push("toLocaleString " + (this === source) + " " + typeof locales + " " + typeof options + " " + arguments.length);\n    return "text " + item.double();\n  },\n};', "[source].toLocaleString()");

// Other ways to come by the built-in: one place each.
const NEXT = 'const values = @V;\nconst steps = {\n  index: 0,\n  next(hint) {\n    log.push("next " + (this === steps) + " " + typeof hint);\n    return ' + STEP + ";\n  },\n};\nconst source = { [Symbol.iterator]: () => steps };\n";
for (const [builtin, [text, values, early, call, show, more]] of Object.entries(WALKERS)) {
  const body = more + NEXT.replaceAll("@V", values);
  let ways: Record<string, string>;
  if (call.startsWith("new ")) {
    const base = call.slice(4, call.indexOf("("));
    ways = { "taken-as-a-value": "new (([" + base + "])[0])(source)", "made-by-reflect-construct": "Reflect.construct(" + base + ", [source])", "found-by-a-name-put-together-at-run-time": 'new globalThis[["' + base.slice(0, 2) + '", "' + base.slice(2) + '"].join("")](source)', bound: "new (" + base + ".bind(null, source))()" };
  } else {
    const member = call.slice("Object.".length, call.indexOf("("));
    const rest = call.slice(call.indexOf("(source") + "(source".length, -1);
    ways = {
      "taken-as-a-value": "([Object." + member + "])[0](source" + rest + ")", "applied-by-reflect": "Reflect.apply(Object." + member + ", undefined, [source" + rest + "])", "called-by-call": "Object." + member + ".call(null, source" + rest + ")",
      "found-by-a-name-put-together-at-run-time": 'Object[["' + member.slice(0, 3) + '", "' + member.slice(3) + '"].join("")](source' + rest + ")", bound: "Object." + member + ".bind(null, source" + rest + ")()",
    };
  }
  for (const [way, used] of Object.entries(ways)) {
    write(builtin + "-" + way + "-runs-next-of-a-plain-object", text + ", " + way.replaceAll("-", " ") + ", runs the next method of a plain object.", body + attempt(used, show));
  }
}

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
