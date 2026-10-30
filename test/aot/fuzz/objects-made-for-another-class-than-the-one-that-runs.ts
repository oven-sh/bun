// Small programs about one object that is made by one constructor for another class. Each class is used in one way alone unless the draw says otherwise, no function of the program is handed the object,
// and every line is printed at once, by `console.log` itself.
//
//   above       nothing, a function that stores to `this`, a class with fields, an empty class, a built-in class, a proxy of a class, a bound function, `null`
//   the target  a class beside the maker, one or two steps below it, one or two steps above it, the class above both, a class or a function that has nothing to do with it, a function whose
//               `prototype` was replaced by an object, by `null` or by a number, a built-in class, a bound class, a proxy of a class, a proxy that answers with another `prototype`, the maker itself
//   made by     `Reflect.construct` with a new target; a constructor that hands its `new.target` on; `super()` that returns another object; `Object.setPrototypeOf` and `__proto__` behind the making;
//               another class put above the maker ahead of the making; `Object.create` and `call`; bound functions and proxies with a `construct` trap; `extends` over a condition
//   then        stores by name, under keys and indices, `+=`, `delete`, `Object.assign`, `defineProperty`; `freeze`, `seal`, `preventExtensions` and what they leave possible; keys, own names, entries,
//               `for in`, a spread, a pattern with a rest, JSON; `in`, `hasOwn`, `instanceof`, the prototype, `constructor`; methods, getters, setters and private names of both classes
//   beside      nothing; or the target, the maker or both are also constructed in the ordinary way, ahead or behind
//   where       the top of the file, a function called once, a function called three times, an async function behind an `await`, a generator, a method
import type { Random } from "./random";

type Built = { name: string; given: string; reads: string[] };

const builtIns: Built[] = [
  { name: "Object", given: "", reads: ["typeof o.valueOf()"] },
  {
    name: "Array",
    given: "",
    reads: ["o.length", "o.push(4)", "Array.isArray(o)", "o.join()"],
  },
  {
    name: "Array",
    given: "3",
    reads: ["o.length", "o.push(4)", "Array.isArray(o)", "o.indexOf(4)"],
  },
  {
    name: "Map",
    given: "",
    reads: ['o.set("k", 1).size', 'o.get("k")', "o.size"],
  },
  { name: "Set", given: "", reads: ["o.add(1).size", "o.has(1)", "o.size"] },
  {
    name: "Error",
    given: '"told"',
    reads: ["o.message", "typeof o.stack", "String(o)"],
  },
  {
    name: "RegExp",
    given: '"a", "g"',
    reads: ["o.lastIndex", 'o.test("aa")', "o.source", "o.lastIndex"],
  },
  {
    name: "Date",
    given: "0",
    reads: ["o.getTime()", "typeof o.toISOString()"],
  },
  {
    name: "Uint8Array",
    given: "2",
    reads: ["o.length", "o[0]", "(o[1] = 300)", "o[1]", "o.byteLength"],
  },
  { name: "Number", given: "5", reads: ["o.valueOf()", "o + 1", "typeof o"] },
  {
    name: "String",
    given: '"st"',
    reads: ["o.length", "o[0]", "o + 1", "typeof o"],
  },
  {
    name: "Promise",
    given: "() => {}",
    reads: ["typeof o.then", "o instanceof Promise"],
  },
  { name: "ArrayBuffer", given: "4", reads: ["o.byteLength"] },
  { name: "WeakMap", given: "", reads: ["o.has(o)", "o.set(o, 1).has(o)"] },
];

const typeArguments: Record<string, string> = {
  Array: "<any>",
  Map: "<any, any>",
  Set: "<any>",
  Promise: "<any>",
  WeakMap: "<any, any>",
};

export function generate(random: Random, isTyped = false): string {
  const numbers = ["0", "1", "2", "7", "1.5", "-0", "2 ** 31"];
  const value = () => random.pick([...numbers, '"t"', '""', "null", "undefined", "true"]);
  /** A value for the member, of its written type where there are types. */
  const valueOf = (name: string) =>
    !isTyped
      ? value()
      : name === "x"
        ? random.pick(numbers)
        : name === "y"
          ? random.pick(['"t"', '""', '"longer"'])
          : name === "z"
            ? random.pick(["null", "3"])
            : value();
  const typeOf = (name: string) => (name === "x" ? "number" : name === "y" ? "string" : "number | null");
  const t = (type: string) => (isTyped ? `: ${type}` : "");
  const field = () => random.pick(["x", "x", "y", "z"]);
  const anyName = () => random.pick(["x", "x", "y", "z", "r", "w", "t", "extra"]);
  /** The object where a member is named that its written type may lack. */
  const loose = isTyped ? "(o as any)" : "o";
  // Which fields each class writes down, and which class stands above it: with types a member is named on the object itself only where the written type of the object has it.
  const fieldsOf: Record<string, Set<string>> = {};
  const aboveOf: Record<string, string> = {};
  const writes = (name: string, member: string): boolean =>
    !!name && (!!fieldsOf[name]?.has(member) || writes(aboveOf[name] ?? "", member));
  let writtenClass = "";
  const at = (name: string) => (!isTyped || !writtenClass || writes(writtenClass, name) ? "o" : loose);
  const self = isTyped ? "(this as any)" : "this";
  const caught = isTyped ? "(error as any)" : "error";

  const rootKind = random.weighted([
    [3, "nothing"],
    [isTyped ? 0 : 4, "a function"],
    [4, "a class"],
    [2, "an empty class"],
    [4, "a built-in"],
    [1, "a proxy"],
    [isTyped ? 0 : 1, "a bound function"],
    [isTyped ? 0 : 1, "null"],
  ] as const);
  const built = random.pick(builtIns);
  const given = rootKind === "a built-in" ? built.given : "";
  const hasPrivate: string[] = [];
  const hasMethod: string[] = [];

  /** The members of one class. Few, so that a class often has none. */
  const members = (name: string, isBelow: boolean): string => {
    const taken = (fieldsOf[name] = new Set<string>());
    const fresh = (isEmpty = false) => {
      const drawn = field();
      if (taken.has(drawn) || (isTyped && isEmpty && writes(aboveOf[name] ?? "", drawn))) return "";
      taken.add(drawn);
      return drawn;
    };
    const kinds = random.sample(
      [
        "a field",
        "a field",
        "a field",
        "an empty field",
        "a private name",
        "a getter",
        "a setter",
        "a method",
        "a constructor",
        "a static",
      ],
      random.pick([0, 1, 1, 1, 2, 2, 3]),
    );
    return kinds
      .map(kind => {
        if (kind === "a field") {
          const drawn = fresh();
          return drawn && `${drawn}${t(typeOf(drawn))} = ${valueOf(drawn)};`;
        }
        if (kind === "an empty field") {
          const drawn = fresh(true);
          return drawn && `${drawn}${isTyped ? `!: ${typeOf(drawn)}` : ""};`;
        }
        if (kind === "a private name") {
          hasPrivate.push(name);
          return `#hidden = 1;\nstatic has(given${t("object")}) {\nreturn #hidden in given;\n}\nstatic read(given${t(name)}) {\nreturn given.#hidden;\n}`;
        }
        if (kind === "a getter") return `get twice() {\nreturn ${self}.x * 2;\n}`;
        if (kind === "a setter") return `set both(given${t("any")}) {\n${self}.x = given;\n${self}.y = given;\n}`;
        if (kind === "a method") {
          hasMethod.push(name);
          return `tells() {\nreturn "${name} " + ${self}.x;\n}`;
        }
        if (kind === "a static") return `static kept = "${name}";`;
        const body = random.pick([
          `${self}.w = ${value()};`,
          `${self}.${field()} = ${value()};`,
          `${self}.forItself = new.target === ${name};`,
          `${self}.w = 1;\n${self}.x = 2;`,
        ]);
        return `constructor(...given${t("any[]")}) {\n${isBelow ? (isTyped ? "// @ts-ignore\n" : "") + "super(...given);\n" : ""}${body}\n}`;
      })
      .filter(Boolean)
      .join("\n");
  };
  const klass = (name: string, above: string) =>
    above === "null"
      ? `class ${name} extends null {\nconstructor() {\nreturn Object.create(new.target.prototype);\n}\n}`
      : `class ${name}${above ? ` extends ${above}${isTyped ? (typeArguments[above] ?? "") : ""}` : ""} {\n${((aboveOf[name] = above), members(name, !!above))}\n}`.replace(
          "{\n\n}",
          "{}",
        );
  const oldStyle = (name: string, stored: string) =>
    `function ${name}() {\n${stored}\n}` +
    (random.chance(0.3) ? `\n${name}.prototype.tells = function () {\nreturn "${name} " + this.x;\n};` : "");

  const root = {
    nothing: () => "",
    "a function": () => oldStyle("Root", random.pick(["this.r = 1;", "this.x = 1;", "this.r = 1;\nthis.x = 2;", ""])),
    "a class": () => `class Root {\n${members("Root", false) || "r = 1;"}\n}`,
    "an empty class": () => "class Root {}",
    "a built-in": () => "",
    "a proxy": () => `const Root = new Proxy(\nclass Inner {\nr = 1;\n},\n{},\n);`,
    "a bound function": () =>
      `function Inner() {\nthis.r = 1;\n}\nconst Root = Inner.bind(null);\nRoot.prototype = Inner.prototype;`,
    null: () => "",
  }[rootKind]();
  const above =
    rootKind === "nothing" ? "" : rootKind === "a built-in" ? built.name : rootKind === "null" ? "null" : "Root";

  const relation = random.weighted([
    [5, "beside"],
    [4, "below"],
    [3, "two below"],
    [4, "above"],
    [2, "two above"],
    [2, "the class above both"],
    [2, "another class"],
    [isTyped ? 0 : 2, "another function"],
    [isTyped ? 0 : 2, "a replaced prototype"],
    [2, "a built-in"],
    [1, "bound"],
    [1, "a proxy"],
    [1, "a proxy with another prototype"],
    [1, "itself"],
  ] as const);
  // The maker is a function now and then, where nothing has to stand above it.
  const makerIsOld =
    !isTyped && !above && random.chance(0.3) && !["above", "two above", "the class above both"].includes(relation);
  const maker = (over: string) => (makerIsOld ? oldStyle("Maker", `this.x = ${value()};`) : klass("Maker", over));
  let target = "Target";
  const declared: string[] = [root];
  if (relation === "beside") declared.push(...random.shuffled([maker(above), klass("Target", above)]));
  else if (relation === "below") declared.push(maker(above), klass("Target", "Maker"));
  else if (relation === "two below") declared.push(maker(above), klass("Between", "Maker"), klass("Target", "Between"));
  else if (relation === "above") declared.push(klass("Target", above), maker("Target"));
  else if (relation === "two above")
    declared.push(klass("Target", above), klass("Between", "Target"), maker("Between"));
  else if (relation === "the class above both") {
    declared.push(maker(above));
    target = above && above !== "null" ? above : "Object";
  } else if (relation === "another class") declared.push(maker(above), klass("Target", ""));
  else if (relation === "another function") declared.push(maker(above), oldStyle("Target", "this.t = 1;"));
  else if (relation === "a replaced prototype")
    declared.push(
      maker(above),
      `function Target() {}\nTarget.prototype = ${random.pick(["{ fromThePrototype: 1 }", "null", "7", "Maker.prototype", "[]", "Object.create(null)", "{ set x(given) {}, get x() { return 'of the prototype'; } }"])};`,
    );
  else if (relation === "a built-in") {
    declared.push(maker(above));
    target = random.pick(["Object", "Array", "Map", "Error", "Function", "Date", "Promise", "Uint8Array"]);
  } else if (relation === "bound")
    declared.push(maker(above), klass("Beside", above), "const Target = Beside.bind(null);");
  else if (relation === "a proxy")
    declared.push(maker(above), klass("Beside", above), "const Target = new Proxy(Beside, {});");
  else if (relation === "a proxy with another prototype")
    declared.push(
      maker(above),
      klass("Beside", above),
      `const Target = new Proxy(function () {}, {\nget(from${t("any")}, key${t("any")}, receiver${t("any")}) {\nreturn key === "prototype" ? Beside.prototype : Reflect.get(from, key, receiver);\n},\n});`,
    );
  else {
    declared.push(maker(above));
    target = "Maker";
  }

  const list = `[${given}]`;
  const isBelowSomething = !makerIsOld && (!!above || relation === "above" || relation === "two above");
  const ways: [number, () => [string, string]][] = [
    [8, () => ["", `Reflect.construct(Maker, ${list}, ${target})`]],
    [
      2,
      () => [
        `class Around {\nconstructor() {\nreturn Reflect.construct(Maker, ${list}, new.target)${isTyped ? " as any" : ""};\n}\n}\nclass Heir extends Around {\n${members("Heir", true).replace(/constructor[^]*?\n}\n?/, "")}\n}`,
        "new Heir()",
      ],
    ],
    [
      isTyped ? 0 : 2,
      () => [
        `function Around() {\nreturn Reflect.construct(Maker, ${list}, new.target);\n}`,
        `Reflect.construct(Around, [], ${target})`,
      ],
    ],
    [
      3,
      () => [
        `class Gives {\nconstructor() {\nreturn ${isTyped ? "(" : ""}${random.pick([`new ${target}(${given})`, `Reflect.construct(Maker, ${list}, ${target})`, "{ x: 5 }", "[]", "Object.create(null)", "function () {}", `Object.create(${target}.prototype)`, "Object.preventExtensions({ x: 5 })", "Object.freeze({})", `new Proxy(new Maker(${given}), {})`])}${isTyped ? ") as any" : ""};\n}\n}\nclass Takes extends Gives {\n${members("Takes", true).replace(/constructor[^]*?\n}\n?/, "") || (fieldsOf.Takes.add("x"), `x${t("number")} = 0;`)}\n}`,
        "new Takes()",
      ],
    ],
    [3, () => ["", `Object.setPrototypeOf(new Maker(${given}), ${target}.prototype)`]],
    [1, () => ["", `{ __proto__: ${target}.prototype, ...new Maker(${given}) }`]],
    [2, () => [`Object.setPrototypeOf(Maker.prototype, ${target}.prototype);`, `new Maker(${given})`]],
    ...(isBelowSomething
      ? ([[3, () => [`Object.setPrototypeOf(Maker, ${target});`, `new Maker(${given})`]]] as [
          number,
          () => [string, string],
        ][])
      : []),
    ...(makerIsOld || rootKind === "a function"
      ? ([
          [
            3,
            () => [
              `const made = Object.create(${target}.prototype);\n${makerIsOld ? "Maker" : "Root"}.${random.pick(["call(made)", "apply(made, [])"])};`,
              "made",
            ],
          ],
        ] as [number, () => [string, string]][])
      : []),
    [1, () => ["", `Reflect.construct(Maker.bind(null), ${list}, ${target})`]],
    [
      1,
      () => [
        `const Trapped = new Proxy(Maker, {\nconstruct(from${t("any")}, given${t("any")}) {\nreturn Reflect.construct(from, given, ${target});\n},\n});`,
        `new Trapped(${given})`,
      ],
    ],
    [
      isTyped ? 0 : 1,
      () => [
        `let which = 1;\nclass Either extends (which ? Maker : ${target}) {\n${field()} = ${value()};\n}`,
        `Reflect.construct(Either, ${list}, ${target})`,
      ],
    ],
    [1, () => ["", `Reflect.construct(${target}, ${list}, Maker)`]],
  ];
  const [setup, made] = random.weighted(ways)();

  // Where a handler stands: nowhere (what is thrown ends the program), round the whole scene, round each step.
  const handlers = random.pick(["nowhere", "nowhere", "round the scene", "round each step"] as const);
  const guarded = (text: string) =>
    handlers === "round each step"
      ? `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", ${caught}.constructor.name);\n}`
      : text;
  const then: [number, () => string][] = [
    [6, (n = anyName()) => `${at(n)}.${n} = ${valueOf(n)};\nconsole.log(${at(n)}.${n});`],
    [3, (n = anyName()) => `console.log((${at(n)}.${n} = ${valueOf(n)}), ${at(n)}.${n});`],
    [2, (n = anyName()) => `${at(n)}["${n}"] = ${valueOf(n)};\nconsole.log(${at(n)}.${n}, Object.keys(o).join());`],
    [2, (n = anyName()) => `key = "${n}";\n${loose}[key] = ${valueOf(n)};\nconsole.log(${loose}[key], ${at(n)}.${n});`],
    [2, (n = anyName()) => `${at(n)}.${n} += 1;\nconsole.log(${at(n)}.${n});`],
    [1, (n = anyName(), from = n === "x" ? at(n) : loose) => `${from}.${n}++;\nconsole.log(${from}.${n});`],
    [3, (n = anyName()) => `console.log(delete ${loose}.${n}, ${at(n)}.${n}, "${n}" in o);`],
    [4, () => `console.log(Object.isFrozen(Object.freeze(o)));`],
    [2, () => `console.log(Object.isSealed(Object.seal(o)), Object.isFrozen(o));`],
    [2, () => `console.log(Object.isExtensible(Object.preventExtensions(o)));`],
    [1, () => `console.log(Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o));`],
    [5, () => `console.log(Object.keys(o).join());`],
    [5, () => `console.log(JSON.stringify(o));`],
    [2, () => `for (const each in o) console.log(each, ${loose}[each]);`],
    [2, () => `console.log(Object.keys({ ...o }).join());`],
    [2, () => `console.log(Object.entries(o).join(";"));`],
    [2, () => `console.log(Object.getOwnPropertyNames(o).join());`],
    [1, () => `console.log(Reflect.ownKeys(o).length);`],
    [2, () => `console.log(o instanceof Maker, o instanceof ${target});`],
    [
      2,
      () =>
        `console.log(Object.getPrototypeOf(o) === ${target}.prototype, Object.getPrototypeOf(o) === Maker.prototype);`,
    ],
    [1, () => `console.log(${loose}.constructor === ${target}, ${loose}.constructor === Maker);`],
    [2, () => `console.log(typeof ${loose}.tells, typeof ${loose}.tells === "function" ? ${loose}.tells() : "none");`],
    [2, () => `console.log(${loose}.twice);`],
    [2, () => `${loose}.both = ${value()};\nconsole.log(${at("x")}.x, ${at("y")}.y, ${loose}.both);`],
    [
      2,
      (n = anyName()) =>
        `Object.defineProperty(o, "${n}", { value: 5, enumerable: ${random.chance(0.5)}, configurable: true, writable: ${random.chance(0.5)} });\nconsole.log(${at(n)}.${n}, Object.keys(o).join());`,
    ],
    [2, (n = anyName()) => `console.log(JSON.stringify(Object.getOwnPropertyDescriptor(o, "${n}")));`],
    [3, (n = anyName()) => `console.log("${n}" in o, Object.hasOwn(o, "${n}"), typeof ${at(n)}.${n});`],
    [2, () => `{\nconst { x, ...rest } = ${at("x")};\nconsole.log(x, Object.keys(rest).join());\n}`],
    [2, () => `Object.assign(o, { x: ${valueOf("x")}, extra: 3 });\nconsole.log(${at("x")}.x, ${loose}.extra);`],
    [1, () => `${loose}[0] = 1;\nconsole.log(${loose}[0], ${loose}.length);`],
    [3, () => `console.log(${at("x")}.x, ${at("y")}.y, ${loose}.z, ${loose}.r, ${loose}.w, ${loose}.t);`],
    [1, () => `console.log(Object.prototype.toString.call(o));`],
    [
      1,
      () =>
        `{\nconst again${t("any")} = ${made};\nagain.x = 9;\nconsole.log(${at("x")}.x, again.x, Object.keys(again).join());\n}`,
    ],
    ...hasPrivate.map((name): [number, () => string] => [
      2,
      () => `console.log(${name}.has(o));\nconsole.log(${name}.has(o) ? ${name}.read(${loose}) : "has none");`,
    ]),
    ...(rootKind === "a built-in"
      ? built.reads.map((read): [number, () => string] => [2, () => `console.log(${read.replace(/\bo\b/g, loose)});`])
      : []),
  ];

  const ordinary = (name: string) =>
    `{\nconst usual${t("any")} = new ${isTyped ? `(${name} as any)` : name}(${given});\nconsole.log(Object.keys(usual).join(), usual.x);\n}`;
  const beside = random.weighted([
    [6, "nothing"],
    [1, "the target ahead"],
    [1, "the target behind"],
    [1, "the maker ahead"],
    [1, "both ahead"],
  ] as const);
  // The written type of the object: what the making says by itself, the maker, the target, or none.
  const saysItself = /^(Reflect\.construct\(Maker,|new (Maker|Heir|Takes|Trapped)\(|Object\.setPrototypeOf\()/.test(
    made,
  );
  const written = !isTyped
    ? ""
    : random.pick([
        saysItself ? "" : ": any",
        saysItself ? "" : ": any",
        /^(Reflect\.construct\(Maker,|new (Maker|Trapped)\()/.test(made) ? ": Maker" : ": any",
        target === "Target" && !/^const Target/m.test(declared.join("\n")) ? ": Target" : ": any",
        ": any",
      ]);
  writtenClass =
    written === ": any"
      ? ""
      : written
        ? written.slice(2)
        : (/^new (Heir|Takes)/.exec(made)?.[1] ?? (made.startsWith("Object.") ? "" : "Maker"));
  const scene = [
    beside === "the target ahead" || beside === "both ahead" ? guarded(ordinary(target)) : "",
    beside === "the maker ahead" || beside === "both ahead" ? guarded(ordinary("Maker")) : "",
    setup,
    `const o${written} = ${made}${written && written !== ": Maker" ? " as any" : ""};`,
    ...Array.from({ length: random.between(1, 4) }, () => guarded(random.weighted(then)())),
    beside === "the target behind" ? guarded(ordinary(target)) : "",
    random.chance(0.5) ? `console.log(Object.keys(o).join(), JSON.stringify(o));` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const whole =
    `let key${t("string")} = "x";\n${declared.filter(Boolean).join("\n")}\n` +
    (handlers === "nowhere"
      ? scene
      : `try {\n${scene}\n} catch (error) {\nconsole.log("THROWS", ${caught}.constructor.name);\n}`);
  const place = random.pick(["top", "top", "top", "once", "thrice", "async", "generator", "method"] as const);
  const end = isTyped ? "export {};\n" : "";
  if (place === "top") return `${whole}\n${end}`;
  if (place === "once") return `function run() {\n${whole}\n}\nrun();\n${end}`;
  if (place === "thrice") return `function run() {\n${whole}\n}\nrun();\nrun();\nrun();\n${end}`;
  if (place === "async") return `async function run() {\nawait null;\n${whole}\n}\nawait run();\n${end}`;
  if (place === "generator")
    return `function* run() {\nyield 1;\n${whole}\n}\nfor (const step of run()) console.log("step", step);\n${end}`;
  return `const holder = {\nrun() {\n${whole}\n},\n};\nholder.run();\n${end}`;
}
