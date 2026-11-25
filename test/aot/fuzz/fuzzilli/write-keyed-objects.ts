// Writes programs that read, store, call and delete members by computed keys. For write-random-keyed-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Keys are literals out of lists and tables, joined and cut strings, whole numbers and their texts, symbols, enumerated keys and keys of another kind now and then. Objects are tables, records of several shapes, classes, lists, maps of functions, objects without a prototype, proxies and accessors.
// Loops look members up by such keys, call what they find, count under them, copy, rename and delete them, while an object gets or loses members.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeKeyedObjects(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const number = isTyped ? ": number" : "";
  const self = isTyped ? "this: any" : "";
  const selfAnd = isTyped ? "this: any, " : "";
  const names = ["a", "b", "run", "size", "0", "1", "name", "length", "x-y", "a1"];
  const name = () => random.pick(names);
  const quoted = () => JSON.stringify(name());
  let nameCount = 0;
  const value = (from: string[] = []): string =>
    random.pick([...from, ...from, "1", "2", "0.5", '"text"', "null", "undefined", "[1]", "{ a: 3 }", "true", "-0"]);
  const callable = (): string =>
    random.pick([
      `function (${selfAnd}one${any})${any} {\n  return plus(this?.size ?? 0, one);\n}`,
      `(one${any})${any} => plus(one, ${random.pick(["1", "0.5", "steps"])})`,
      `(one${any})${any} => ${random.pick(["one", "++steps", '"called"'])}`,
      "shared",
      `function (${self})${any} {\n  return Object.keys(this ?? {}).length;\n}`,
    ]);
  // One literal names no member twice.
  let used = new Set<string>();
  const key = (): string => {
    const free = names.filter(each => !used.has(each));
    const chosen = free.length ? random.pick(free) : "k" + nameCount++;
    used.add(chosen);
    return JSON.stringify(chosen);
  };
  const fresh = (write: () => string): string => {
    const outer = used;
    used = new Set();
    const text = write();
    used = outer;
    return text;
  };
  const member = (): string =>
    random.pick([
      () => `${key()}: ${value()}`,
      () => `${key()}: ${value()}`,
      () => `${key()}: ${callable()}`,
      () => `${key()}: ${callable()}`,
      () => `get ${key()}() {\n  return ${random.pick(["++steps", "4", '"got"'])};\n}`,
      () => `[${key()}]: ${value()}`,
      () => {
        const written = used.has("sign") ? key() : "[sign]";
        used.add("sign");
        return `${written}: ${random.pick(["7", callable()])}`;
      },
      () => `["q" + ${nameCount++}]: ${value()}`,
      () => `${key()}(one${any})${any} {\n  return plus(one, 2);\n}`,
    ])();
  const object = (): string => fresh(writeObject);
  const writeObject = (): string =>
    random.pick([
      () => `{ ${Array.from({ length: 1 + random.below(4) }, member).join(", ")} }`,
      () => `{ ${Array.from({ length: 1 + random.below(4) }, member).join(", ")} }`,
      () => `{ ${Array.from({ length: 2 + random.below(3) }, () => `${key()}: ${callable()}`).join(", ")} }`,
      () => `{ ${Array.from({ length: 2 + random.below(3) }, () => `${key()}: ${random.below(5)}`).join(", ")} }`,
      () => `new Table(${random.below(4)})`,
      () => `new Wide(${random.below(4)})`,
      () => `[${Array.from({ length: random.below(4) }, () => value()).join(", ")}]`,
      () => `Object.assign(Object.create(null), { ${key()}: 1, ${key()}: ${callable()} })`,
      () => `Object.create({ a: 5, run: (one${any})${any} => one })`,
      () => `JSON.parse('{"a":1,"b":2,"0":3,"name":"n"}')`,
      () => `Object.fromEntries([["a", 1], ["size", 2]])`,
      () => `Object.freeze({ a: 1, run: () => 2 })`,
      () => `new Proxy({ a: 1 }, { get: (from${any}, key) => (key in from ? from[key] : undefined) })`,
      () => `Object.defineProperty({ b: 1 }, "a", { get: () => ++steps, enumerable: true })`,
    ])();
  const lines: string[] = [
    `let steps${number} = 0;`,
    'const sign = Symbol("sign");',
    `const told${isTyped ? ": string[]" : ""} = [];`,
    `const shared = (one${any})${any} => one;`,
    `function plus(one${any}, two${any})${any} {`,
    '  return typeof one === "number" && typeof two === "number" ? one + two : typeof one === "number" ? one + 100 : typeof two === "number" ? two + 1000 : 1;',
    "}",
    `function show(value${any}, depth${number} = 0)${isTyped ? ": string" : ""} {`,
    '  if (typeof value === "function") return "function";',
    '  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);',
    '  if (depth > 2) return "deep";',
    '  return (Array.isArray(value) ? "[" : "{") + Reflect.ownKeys(value).map(key => String(key) + ":" + show(value[key' +
      (isTyped ? " as any" : "") +
      '], depth + 1)).join() + "}";',
    "}",
    "class Table {",
    `  size${any};`,
    `  a${any} = 1;`,
    `  ["x-y"]${any} = 2;`,
    `  constructor(size${any}) {`,
    "    this.size = size;",
    "  }",
    `  run(one${any})${any} {`,
    "    return plus(this.size, one);",
    "  }",
    `  ["name"](one${any})${any} {`,
    "    return plus(one, this.a);",
    "  }",
    "}",
    "class Wide extends Table {",
    `  run(one${any})${any} {`,
    "    return plus(super.run(one), 1);",
    "  }",
    `  get b()${any} {`,
    "    return this.size;",
    "  }",
    "}",
  ];
  const tables = Array.from({ length: 1 + random.below(3) }, (_, index) => `table${index}`);
  for (const table of tables) lines.push(`const ${table}${any} = ${object()};`);
  lines.push(`const keys${any} = [${Array.from({ length: 2 + random.below(5) }, () => random.pick([quoted, quoted, quoted, () => String(random.below(3)), () => "sign", () => random.pick(["0.5", "-1", "null", "undefined", '"1"', '"zz"'])])()).join(", ")}];`); // prettier-ignore
  if (isTyped)
    lines.push(
      `const known${isTyped ? ": Record<string, (one: any) => any>" : ""} = { a: one => plus(one, 3), run: one => one, size: () => 4 };`,
    );
  // Constructors that copy what they are given between fields of their own: in which order the keys stand shows.
  const recordCalls: string[] = [];
  for (let index = 0; index < random.below(3); index++) {
    const isClass = random.chance(0.5);
    const own = () => `this${isClass && isTyped ? " as any" : ""}`;
    const me = isTyped ? "(this as any)" : "this";
    const step = (): string =>
      random.pick([
        () => `${me}${random.pick([".size", ".a", ".host", ".kind", '["x-y"]', ".b"])} = ${value(["given"])};`,
        () => `${me}${random.pick([".size", ".a", ".host", ".kind", ".b"])} = ${value()};`,
        () => `${me}.kind = typeof ${me}.size + "/" + typeof ${me}.host;`,
        () => `Object.assign(${own()}, given);`,
        () => `Object.defineProperties(${own()}, Object.getOwnPropertyDescriptors(Object(given)));`,
        () => `for (const each in Object(given)) ${me}[each] = given[each];`,
        () => `for (const [each, held] of Object.entries(Object(given))) ${me}[each] = held;`,
        () => `Reflect.set(${own()}, ${quoted()}, 1);`,
        () => `delete ${me}${random.pick([".a", ".size", ".host"])};`,
        () => `if (given?.${random.pick(["a", "size", "host"])}) ${me}.b = 2;`,
        () =>
          `Object.defineProperty(${own()}, ${quoted()}, { value: 5, enumerable: ${random.pick(["true", "false"])}, configurable: true, writable: true });`,
      ])();
    const steps = Array.from({ length: 2 + random.below(4) }, step);
    lines.push(
      ...(isClass
        ? [
            `class Record${index} {`,
            ...(random.chance(0.4) ? [`  ${random.pick(["size", "a", "host"])}${any} = ${value()};`] : []),
            `  constructor(given${any}) {`,
            ...indent(indent(steps)),
            "  }",
            "}",
          ]
        : [`function Record${index}(${selfAnd}given${any}) {`, ...indent(steps), "}"]),
    );
    const given = () =>
      `{ ${[...new Set(Array.from({ length: random.below(4) }, () => random.pick(["size", "a", "host", "0", "kind", "x"])))].map(each => `${each}: ${value()}`).join(", ")} }`;
    const made = Array.from(
      { length: 2 + random.below(3) },
      () =>
        `new ${isTyped ? `(Record${index} as any)` : `Record${index}`}(${random.chance(0.85) ? given() : random.pick(["null", "[1, 2]", '"ab"'])})`,
    );
    lines.push(
      `function fill${index}(count${number})${any} {`,
      `  const all${any} = [];`,
      "  for (let turn = 0; turn < count; turn++) {",
      "    all.length = 0;",
      ...made.map(each => `    all.push(${each});`),
      ...(random.chance(0.4) ? [`    all[0].${random.pick(["late", "b", "size"])} = turn;`] : []),
      "  }",
      "  return all;",
      "}",
    );
    recordCalls.push(
      "try {",
      `  console.log(show(fill${index}(${random.pick(["1", "3", "8"])})));`,
      "} catch (error) {",
      `  console.log("threw", (error${isTyped ? " as any" : ""})?.name);`,
      "}",
    );
  }
  const functionCount = 1 + random.below(3);
  const calls: string[] = [];
  for (let index = 0; index < functionCount; index++) {
    const form = random.pick(["function", "function", "function", "arrow", "generator", "async"]);
    const of = () =>
      random.pick(["one", "one", "one", ...tables, "{ ...one, a: 2 }".replace("{", "({").replace("}", "})"), "counts"]);
    const place = () => random.pick(["one", "one", "one", ...tables, "counts"]);
    const at = (): string =>
      random.pick([
        "key",
        "key",
        "key",
        "key",
        "keys[turn % keys.length]",
        "keys[0]",
        quoted(),
        "String(key)",
        "`${String(key)}`",
        '"a" + turn % 3',
        "turn",
        "turn % 2",
        "sign",
        "String(key).slice(0, 1)",
        'typeof key === "string" ? key : "a"',
        "Object.keys(one)[0]",
      ]);
    const statement = (): string[] =>
      random.pick([
        () => [`total = plus(total, ${of()}[${at()}]);`],
        () => [`total = plus(total, ${of()}[${at()}]);`],
        () => { const found = `found${nameCount++}`; return [`const ${found}${any} = ${of()}[${at()}];`, `if (${random.pick([`${found} !== undefined`, `typeof ${found} === "function"`, found, `${found} == null`])}) total = plus(total, ${random.pick([`typeof ${found} === "function" ? ${found}(turn) : ${found}`, found])});`]; }, // prettier-ignore
        () => {
          const [where, which] = [place(), at()];
          return [`if (typeof ${where}[${which}] === "function") total = plus(total, ${where}[${which}](turn));`];
        },
        () => {
          const [where, which] = [place(), at()];
          return [`total = plus(total, ${where}[${which}]?.(turn));`].map(line =>
            random.chance(0.6) ? `try {\n  ${line}\n} catch (error) {\n  total = plus(total, 5);\n}` : line,
          );
        },
        () => [`${place()}[${at()}] = ${value(["turn", "total"])};`],
        () => [`counts[${at()}] = (counts[${at()}] ?? 0) + 1;`],
        () => [`(counts[${at()}] ??= []).push?.(turn);`],
        () => [`${place()}[${at()}]++;`],
        () => [`if (${at()} in Object(${of()})) total = plus(total, 1);`],
        () => [`if (Object.hasOwn(Object(${of()}), ${at()})) total = plus(total, 2);`],
        () => [`delete ${place()}[${at()}];`],
        () => [`for (const each in ${of()}) total = plus(total, ${random.pick(["one[each]", "each.length", "1"])});`],
        () => [
          `for (const [each, held] of Object.entries(${of()})) total = plus(total, ${random.pick(["held", "each.length", "counts[each]"])});`,
        ],
        () => {
          const copy = `copy${nameCount++}`;
          return [
            `const ${copy}${any} = {};`,
            `for (const each of Object.keys(${of()})) ${copy}[${random.pick(["each", '"k" + each', "each.toUpperCase()"])}] = one[each];`,
            `total = plus(total, Object.keys(${copy}).length);`,
          ];
        },
        () => {
          const rest = `rest${nameCount++}`;
          return [
            `const { [${random.pick(["String(key)", quoted(), '"a"'])}]: got${rest}, ...${rest} }${any} = ${of()};`,
            `total = plus(total, plus(got${rest}, Object.keys(${rest}).length));`,
          ];
        },
        () => [
          `switch (${at()}${isTyped ? " as any" : ""}) {`,
          `  case ${quoted()}:`,
          "    total = plus(total, 1);",
          "    break;",
          `  case ${random.pick([quoted(), "1", "sign"])}:`,
          `    total = plus(total, one[${quoted()}]);`,
          "    break;",
          "  default:",
          "    total = plus(total, 0);",
          "}",
        ],
        () => [`total = plus(total, Reflect.get(Object(${of()}), ${at()}));`],
        () => [`text += typeof ${of()}[${at()}];`],
        () => {
          const run = `run${nameCount++}`;
          return [
            `const ${run}${any} = ${fresh(() => `{ ${key()}: ${callable()}, ${key()}: ${callable()}, q: shared }`)};`,
            `total = plus(total, ${run}[${at()}]?.(turn) ?? 9);`,
          ];
        },
        ...(isTyped
          ? [() => [`total = plus(total, known[${random.pick(["key as string", '"a"', "String(key)"])}]?.(turn));`]]
          : []),
        ...(form === "generator" ? [() => [`yield one[${at()}];`]] : []),
        ...(form === "async" ? [() => ["await null;"], () => [`total = plus(total, await one[${at()}]);`]] : []),
      ])();
    const body = Array.from({ length: 1 + random.below(4) }, statement).flat();
    if (random.chance(0.25)) body.push(`if (turn === ${1 + random.below(3)}) ${random.pick([`${random.pick(["one", ...tables])}[${quoted()}] = ${callable().startsWith("function") ? "shared" : "turn"};`, `delete one[${quoted()}];`, `one = ${object()};`, `keys.push(${quoted()});`, `Object.assign(${random.pick(["one", ...tables])}, { ${quoted()}: ${value()} });`])}`); // prettier-ignore
    const loop = random.pick([
      ["for (let turn = 0; turn < count; turn++) {", "  const key" + any + " = keys[turn % keys.length];"],
      ["for (let turn = 0; turn < count; turn++) {", "  const key" + any + " = keys[turn % keys.length];"],
      ["let turn = 0;", "for (const key of keys.slice(0, 6)) {", "  turn++;"],
      [
        "for (let turn = count; turn > 0; turn--) {",
        `  const key${any} = ${random.pick([quoted(), "names[turn % 3]"])};`,
      ],
      ["let turn = 0;", "for (const key in one) {", "  if (turn++ > 8) break;"],
    ]);
    const text = [
      `let total${any} = 0;`,
      'let text = "";',
      `const counts${any} = ${random.pick(["{}", "Object.create(null)", "[]", "{ a: 1 }"])};`,
      'const names = ["a", "run", "size"];',
      ...loop,
      ...indent(body),
      "}",
    ];
    const result = "[total, text.slice(0, 200), counts]";
    const head = `(one${any}, count${number})`;
    if (form === "generator")
      lines.push(
        `function* work${index}${head}${isTyped ? ": any" : ""} {`,
        ...indent([...text, `yield ${result};`]),
        "}",
      );
    else if (form === "async")
      lines.push(
        `async function work${index}${head}${isTyped ? ": Promise<any>" : ""} {`,
        ...indent([...text, `return ${result};`]),
        "}",
      );
    else if (form === "arrow")
      lines.push(`const work${index} = ${head}${any} => {`, ...indent([...text, `return ${result};`]), "};");
    else lines.push(`function work${index}${head}${any} {`, ...indent([...text, `return ${result};`]), "}");
    for (let count = 2 + random.below(3); count > 0; count--) {
      const given = `${random.chance(0.75) ? object() : random.pick(tables)}, ${random.pick(["1", "3", "6", "14"])}`;
      const call =
        form === "generator"
          ? `[...work${index}(${given})]`
          : form === "async"
            ? `await work${index}(${given})`
            : `work${index}(${given})`;
      calls.push(
        "try {",
        `  console.log(show(${call}));`,
        "} catch (error) {",
        `  console.log("threw", (error${isTyped ? " as any" : ""})?.name);`,
        "}",
      );
    }
  }
  lines.push(
    ...recordCalls,
    ...calls,
    `console.log(steps, told.length, ${tables.map(table => `show(${table})`).join(", ")}, show(keys));`,
  );
  return {
    name: `${tables.length}-tables--${functionCount}-functions`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(/(?<![.\w"'])(?:work\d|Record\d|fill\d|table\d|steps|sign|told|shared|plus|show|Table|Wide|keys|known)\b(?!["'])/g, each => each + suffix).replace(/\.\.\.work(\d)/g, (_, digit) => `...work${digit}${suffix}`) : line)), // prettier-ignore
  };
}
export const writeSceneOfKeyedObjects = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeKeyedObjects(random, isTypeScript, "printValue", "_" + n).lines;
