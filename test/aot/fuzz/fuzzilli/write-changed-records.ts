// Writes programs whose loops make records (literals, instances of classes, lists, records in records) and change them: fields are stored, added, deleted and replaced, in branches, in tries that a throw leaves half way, in switches, in inner loops and by small helpers.
// What the record holds is read behind the change by every form of a read: the field, `in`, hasOwn, typeof, its keys, a spread, JSON, a text. Some records are kept, or handed to a function that nothing is known about. For write-random-record-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeChangedRecords(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const any = isTyped ? ": any" : "";
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const fields = ["a", "b", "c", "d"].slice(0, 2 + random.below(3));
  const field = () => random.pick(fields);
  const isInline = random.chance(0.75);
  // In a quiet program no record is handed to anything: what it holds may stay in registers.
  const isQuiet = random.chance(0.6);
  const plain = () =>
    random.pick(["i", "i + 1", "i * 0.5", "n", "0", "1", "7", "2.5", "-0", "NaN", "null", "undefined", "true", '"t"', '"text" + i', "i & 1", "given", "i > 2"]); // prettier-ignore
  const value = () => (isQuiet || random.chance(0.9) ? plain() : random.pick(["{ x: i }", "[i, 2]"]));
  const condition = () =>
    random.pick(["i & 1", "i % 3 === 1", "i > 1", "i === 2", "given", "i < n - 1", "!(i & 2)", "seen > 2", "i % 3"]);
  // What a record is made by.
  const recordClass = random.chance(0.4);
  const fresh = (): string => {
    const own = fields.filter(() => random.chance(0.75));
    const entries = own.map(each =>
      random.chance(0.9) ? `${each}: ${value()}` : random.pick([`["${each}"]: ${value()}`, `"${each}": ${value()}`]),
    );
    if (recordClass && random.chance(0.4)) return `new Record${suffix}(${value()})`;
    const roll = isQuiet ? 10 : random.below(20);
    if (roll === 0) return `[${[value(), value(), value()].slice(0, 1 + random.below(3)).join(", ")}]`;
    if (roll === 1) return `Object.assign({}, { ${entries.join(", ")} })`;
    if (roll === 2) return `{ ...shared${suffix}, ${entries.join(", ")} }`;
    if (roll === 3) return `make${suffix}(${value()}, ${value()})`;
    if (roll === 4) return `{ ${[...entries, `get got() {\n  return this.${field()};\n}`].join(", ")} }`;
    return `{ ${entries.join(", ")} }`;
  };
  const records = ["o", "p"];
  let names = 0;
  const quietChange = (record: string, key: string): string =>
    random.pick([
      () => `${record}.${key} = ${value()};`,
      () => `${record}.${key} = ${value()};`,
      () => `delete ${record}.${key};`,
      () => `delete ${record}.${key};`,
      () => `${record}.${key} ${random.pick(["+=", "-=", "|=", "*="])} ${random.pick(["i", "1", "0.5", "n"])};`,
      () => `${record}.${key} ${random.pick(["??=", "||=", "&&="])} ${value()};`,
      () => `put${suffix}(${record}, ${value()});`,
      () => `drop${suffix}(${record});`,
      () => `bump${suffix}(${record});`,
    ])();
  const quietRead = (record: string, key: string): string =>
    random.pick([
      () => `show${suffix}(${record}.${key})`,
      () => `${record}.${key}`,
      () => `("${key}" in ${record})`,
      () => `("${key}" in ${record})`,
      () => `Object.hasOwn(${record}, "${key}")`,
      () => `typeof ${record}.${key}`,
      () => `(${record}.${key} === undefined)`,
      () => `(${record}.${key} ? 1 : 2)`,
      () => `(${record}.${key} ?? "none")`,
    ])();
  const change = (held: string[]): string[] => {
    const record = random.pick(held);
    const other = random.pick(held);
    const key = field();
    if (isQuiet)
      return random.chance(0.25)
        ? [`text += ${quietRead(record, key)} + ",";`]
        : random.chance(0.1)
          ? [`${record} = ${fresh()};`]
          : random.chance(0.1)
            ? [`${record}.${key} = ${other}.${field()};`]
            : [quietChange(record, key)];
    return random.pick([
      () => [`${record}.${key} = ${value()};`],
      () => [`${record}.${key} = ${value()};`],
      () => [`${record}.${key} = ${value()};`],
      () => [`${record}.${key} ${random.pick(["??=", "||=", "&&="])} ${value()};`],
      () => [`${record}.${key} ${random.pick(["+=", "-=", "|=", "*="])} ${random.pick(["i", "1", "0.5", "n"])};`],
      () => [`delete ${record}.${key};`],
      () => [`delete ${record}.${key};`],
      () => [`delete ${record}["${key}"];`],
      () => [`${record}.${key}++;`],
      () => [`${record}["${key}"] = ${value()};`],
      () => [`${record}[${random.pick([`i & 1 ? "${key}" : "${field()}"`, `keys${suffix}[i & 1]`])}] = ${value()};`],
      () => [`${record}.${key} = ${other};`],
      () => [`${record}.${key} = ${other}.${field()};`],
      () => [`${record} = ${fresh()};`],
      () => [`${record} = { ...${other}, ${key}: ${value()} };`],
      () => [`${record} = ${other};`],
      () => [`Object.assign(${record}, { ${key}: ${value()} });`],
      () => [`put${suffix}(${record}, ${value()});`],
      () => [`drop${suffix}(${record});`],
      () => [`bump${suffix}(${record});`],
      () => [
        `Object.defineProperty(${record}, "${key}", { value: ${value()}, writable: ${random.pick(["true", "false"])}, enumerable: ${random.pick(["true", "false"])}, configurable: true });`,
      ],
      () => [`[${record}.${key}, ${other}.${field()}] = [${other}.${field()}, ${value()}];`],
      () => [`({ ${key}: last, ...left } = ${record});`],
      () => [`hide${suffix}(${record});`],
      () => [`if (${condition()}) kept${suffix} = ${record};`],
      () => [`text += ${read(record)} + ",";`],
      () => [`text += ${read(record)} + ",";`],
    ])();
  };
  function read(record: string): string {
    const key = field();
    if (isQuiet) return quietRead(record, key);
    return random.pick([
      () => `show${suffix}(${record}.${key})`,
      () => `show${suffix}(${record}.${key})`,
      () => `("${key}" in ${record})`,
      () => `("${key}" in ${record})`,
      () => `Object.hasOwn(${record}, "${key}")`,
      () => `typeof ${record}.${key}`,
      () => `(${record}.${key} === undefined)`,
      () => `show${suffix}(${record}.${key} ?? "none")`,
      () => `show${suffix}(${record}.${key}?.x)`,
      () => `Object.keys(${record}).join("+")`,
      () => `show${suffix}(${record})`,
      () => `show${suffix}({ ...${record} })`,
      () => `(JSON.stringify(${record}) ?? "nothing")`,
      () => `(${record}.${key} ? 1 : 2)`,
      () => `show${suffix}(${record}["${key}"])`,
      () => `show${suffix}(${record}[keys${suffix}[i & 1]])`,
      () => `(${record} === kept${suffix})`,
    ])();
  }
  const leave = (depth: number, inLoop: boolean) =>
    random.pick([
      `throw ${random.pick(["1", "i", `new Error("e" + i)`, "o"])};`,
      `fail${suffix}(i);`,
      `fail${suffix}(i);`,
      ...(inLoop ? ["continue;", "break;"] : []),
      ...(depth > 1 ? ["continue;"] : []),
      `${isTyped ? "(null as any)" : "null"}.x;`,
    ]);
  // A field that changes on both sides of what may leave the block, and is read where it was left for.
  const halfDone = (held: string[], depth: number, inLoop: boolean): string[] => {
    const record = random.pick(held);
    const key = field();
    const changes = (most: number) => Array.from({ length: random.below(most + 1) }, () => quietChange(record, random.chance(0.8) ? key : field())); // prettier-ignore
    const readings = () => Array.from({ length: 1 + random.below(2) }, () => `text += ${quietRead(record, random.chance(0.8) ? key : field())} + ",";`); // prettier-ignore
    const leaves = `if (${condition()}) ${random.chance(0.8) ? random.pick(["throw 1;", "throw i;", `fail${suffix}(i);`]) : leave(depth, inLoop)}`; // prettier-ignore
    const label = "left" + names++;
    return random.chance(0.75)
      ? [
          "try {",
          ...indent([quietChange(record, key), ...changes(1), leaves, ...changes(2)]),
          "} catch {",
          ...indent([...readings(), ...changes(1)]),
          ...(random.chance(0.2) ? ["} finally {", ...indent([...readings(), ...changes(1)])] : []),
          "}",
          ...readings(),
        ]
      : [
          `${label}: {`,
          ...indent([quietChange(record, key), ...changes(1), `if (${condition()}) break ${label};`, ...changes(2)]),
          "}",
          ...readings(),
        ];
  };
  const statements = (depth: number, held: string[], most: number, inLoop = false): string[] => {
    const made: string[] = [];
    for (let times = 1 + random.below(most); times > 0; times--) {
      if (random.chance(0.25)) {
        made.push(...halfDone(held, depth, inLoop));
        continue;
      }
      const roll = depth > 3 ? 10 : random.below(12);
      const inner = (lines = 2) => indent(statements(depth + 1, held, lines, inLoop));
      if (roll === 0)
        made.push(`if (${condition()}) {`, ...inner(), ...(random.chance(0.4) ? ["} else {", ...inner()] : []), "}"); // prettier-ignore
      else if (roll <= 4 && depth < 3) {
        const guarded = [...inner(), `  if (${condition()}) ${leave(depth, inLoop)}`, ...(random.chance(0.6) ? inner() : [])]; // prettier-ignore
        const caught = random.chance(0.85);
        made.push(
          "try {",
          ...guarded,
          ...(caught
            ? [`} catch${random.chance(0.4) ? ` (error${any})` : ""} {`, ...(random.chance(0.8) ? inner() : []), ...indent([`text += "caught" + ${read(random.pick(held))};`])]
            : []),
          ...(!caught || random.chance(0.2) ? ["} finally {", ...inner()] : []),
          "}",
        ); // prettier-ignore
      } else if (roll === 5)
        made.push(`switch (${random.pick(["i % 3", "i & 3", "seen & 1"])}) {`, "  case 0:", ...indent(inner()), ...(random.chance(0.6) ? ["    break;"] : []), "  case 1:", ...indent(inner()), ...(random.chance(0.6) ? ["    break;"] : []), ...(random.chance(0.6) ? ["  default:", ...indent(inner())] : []), "}"); // prettier-ignore
      else if (roll === 6) {
        const at = "j" + names++;
        made.push(`for (let ${at} = 0; ${at} < ${random.pick(["2", "3", "i", "n"])}; ${at}++) {`, ...indent(statements(depth + 1, held, 2, true)), ...(random.chance(0.4) ? [`  if (${random.pick([`${at} === 1`, condition()])}) ${random.pick(["break;", "continue;"])}`] : []), "}"); // prettier-ignore
      } else if (roll === 7) {
        const label = "out" + names++;
        made.push(`${label}: {`, ...inner(), `  if (${condition()}) break ${label};`, ...inner(), "}");
      } else if (roll === 8 && held.length < 3) {
        const inside = "q" + names++;
        made.push("{", `  let ${inside}${any} = ${fresh()};`, ...indent(statements(depth + 1, [...held, inside], 3, inLoop)), `  text += ${read(inside)};`, "}"); // prettier-ignore
      } else made.push(...change(held));
    }
    return made;
  };
  const lines: string[] = [
    `let calls${suffix} = 0;`,
    `let kept${suffix}${any};`,
    `const keys${suffix} = ["${field()}", "${field()}"];`,
    `const shared${suffix}${any} = { ${fields[0]}: 1, x: 2 };`,
    `function show${suffix}(value${any}, depth = 0)${isTyped ? ": string" : ""} {`,
    '  if (typeof value === "function") return "function";',
    '  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);',
    '  if (depth > 2) return "deep";',
    '  if (value instanceof Error) return "error " + value.message.replace(/ \\(.*/s, "");',
    `  return (Array.isArray(value) ? "[" : "{") + Reflect.ownKeys(value).map(key => String(key) + ":" + show${suffix}(value[key], depth + 1)).join() + "}";`,
    "}",
    `const put${suffix} = (record${any}, value${any})${isTyped ? ": void" : ""} => {\n  record.${field()} = value;\n};`,
    `const drop${suffix} = (record${any})${isTyped ? ": void" : ""} => {\n  delete record.${field()};\n};`,
    `const bump${suffix} = (record${any})${isTyped ? ": void" : ""} => {\n  record.${field()} += 1;\n  calls${suffix}++;\n};`,
    `const make${suffix} = (first${any}, second${any})${any} => ({ ${fields[0]}: first, ${fields[1]}: second });`,
    `const fail${suffix} = (turn${any})${isTyped ? ": void" : ""} => {\n  if (turn & 1) throw ${random.pick(["turn", 'new Error("odd")'])};\n};`,
    `const hide${suffix}${any} = [(value${any}) => value][process.argv.length > 9 ? 1 : 0];`,
  ];
  if (recordClass)
    lines.push(
      `class Record${suffix} {`,
      ...(isTyped ? ["  [key: string]: any;"] : []),
      ...fields.filter(() => random.chance(0.6)).map(each => `  ${each}${any} = ${random.pick(["0", "1.5", '"own"', "null", "undefined", "[]"])};`), // prettier-ignore
      `  constructor(first${any}) {`,
      `    this.${field()} = first;`,
      "  }",
      "}",
    );
  const works = 1 + random.below(3);
  const calls: string[] = [];
  for (let work = 0; work < works; work++) {
    const kind = random.pick(["function", "function", "function", "function", "generator", "arrow"]);
    const name = `work${work}${suffix}`;
    const held = records.slice(0, 1 + random.below(2));
    const body = [
      'let text = "";',
      "let seen = 0;",
      `let last${any};`,
      `let left${any};`,
      ...(isInline ? [] : held.map(each => `let ${each}${any} = ${fresh().replaceAll(/\bi\b/g, "0")};`)),
      `for (let i = 0; i < n; i++) {`,
      ...indent([
        "seen++;",
        ...(isInline ? held.map(each => `let ${each}${any} = ${fresh()};`) : []),
        ...statements(1, held, 4),
        `text += ${read(random.pick(held))} + ";";`,
        ...(random.chance(0.4) ? [`text += ${read(random.pick(held))} + ";";`] : []),
        ...(kind === "generator" ? ["yield text.length;"] : []),
      ]),
      "}",
      `return [text.slice(-400), seen, show${suffix}(last), show${suffix}(left)].join("|");`,
    ];
    const head = `(n${any}, given${any})`;
    if (kind === "generator") lines.push(`function* ${name}${head}${any} {`, ...indent(body), "}");
    else if (kind === "arrow") lines.push(`const ${name} = ${head}${any} => {`, ...indent(body), "};");
    else lines.push(`function ${name}${head}${any} {`, ...indent(body), "}");
    for (let times = 1 + random.below(3); times > 0; times--) {
      const call = `${name}(${random.pick(["3", "7", "4", "20", "0", "1"])}, ${random.pick(["0", "1", '"g"', "null", "undefined", "2.5", "{ x: 1 }"])})`;
      const run =
        kind === "generator"
          ? `const steps = ${call};\nlet step = steps.next();\nwhile (!step.done) step = steps.next();\n${print}(step.value);`
          : `${print}(${call});`;
      calls.push("try {", ...indent([run]), `} catch (error) {\n  ${print}("threw", show${suffix}(error));\n}`);
    }
  }
  lines.push(...calls, `${print}(calls${suffix}, show${suffix}(kept${suffix}), show${suffix}(shared${suffix}));`);
  return {
    name: `${works}-functions${isQuiet ? "--quiet" : ""}${recordClass ? "--class" : ""}${isInline ? "" : "--outside"}`,
    lines,
  };
}

/** The lines of a scene whose program prints by `printValue`. */
export function writeSceneOfChangedRecords(next: () => number, count: number, isTyped: boolean): string[] {
  return ["{", ...writeChangedRecords(next, isTyped, "printValue", "_" + count).lines.map(line => "  " + line), "}"];
}
