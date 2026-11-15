// Writes programs whose functions and expressions give a small object, a pair or nothing. For write-random-optional-sweep.ts and for a scene of write-ordinary-scenes.ts.
// The results come out of calls, of methods of several classes under one name, conditional expressions, ||, && and ??, variables that begin as null and loops that carry one turn's result into the next. They are read by members, patterns, ?. and tests, compared, changed, spread, kept, thrown and handed on.
// The same happens at the top of the file, in functions, generators, async functions and methods.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeOptionalResults(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const number = isTyped ? ": number" : "";
  let nameCount = 0;
  /** A small number out of what is in sight. */
  const small = (from: string[]): string => random.pick([...from, ...from, "1", "2", "0.5", `${random.pick(from)} * 2`, `${random.pick(from)} + 1`, `${random.pick(from)} & 3`, '"t"', "true"]); // prettier-ignore
  const nothing = () => random.pick(["null", "null", "undefined", "undefined", "false", "0", '""']);
  const record = (from: string[]): string =>
    random.pick([
      () => `{ a: ${small(from)} }`,
      () => `{ a: ${small(from)}, b: ${small(from)} }`,
      () => `{ b: ${small(from)}, a: ${small(from)} }`,
      () => `{ ok: ${random.pick(["true", "false", `${random.pick(from)} > 2`])}, value: ${small(from)} }`,
      () => `{ ok: false, value: undefined, a: 1 }`,
      () => `{ value: ${small(from)}, next: null }`,
      () => `{ a: ${small(from)}, get b() { return ${random.pick(["7", "this.a", "++steps"])}; } }`,
      () => `new Pair(${small(from)}, ${small(from)})`,
      () => `new Pair(${small(from)}, ${small(from)})`,
      () => `{ a: ${small(from)}, next: { a: ${small(from)} } }`,
      () => `{ a: ${small(from)}, size: ${small(from)}, ok: true }`,
      () => `[${small(from)}, ${small(from)}]`,
      () => `[${small(from)}]`,
      () => `{ run() { return ${small(from)}; }, a: ${small(from)} }`,
      () => `{ a: () => ${small(from)} }`,
      () => `Object.freeze({ a: ${small(from)} })`,
    ])();
  const condition = (from: string[]): string =>
    random.pick([
      `${random.pick(from)} > ${random.below(6)}`,
      `${random.pick(from)} < ${1 + random.below(5)}`,
      `${isTyped ? `(${random.pick(from)} as number)` : random.pick(from)} === ${random.below(5)}`,
      `(${random.pick(from)} & 1) === ${random.below(2)}`,
      `${random.pick(from)} % 3 === ${random.below(3)}`,
      `isWanted(${random.pick(from)})`,
    ]);
  const makerCount = 1 + random.below(3);
  const lines: string[] = [
    `let steps${number} = 0;`,
    `const kept${any} = [];`,
    `let held${any} = null;`,
    isTyped
      ? "class Pair {\n  a: any;\n  b: any;\n  constructor(a: any, b: any) {\n    this.a = a;\n    this.b = b;\n  }\n  sum(): any {\n    return plain(this.a) + plain(this.b);\n  }\n}"
      : "class Pair {\n  constructor(a, b) {\n    this.a = a;\n    this.b = b;\n  }\n  sum() {\n    return plain(this.a) + plain(this.b);\n  }\n}",
    `function isWanted(one${any})${isTyped ? ": boolean" : ""} {\n  return ${random.pick(["one > 2", "(one & 1) === 1", "steps++ % 3 === 0", "one !== 1"])};\n}`,
    `function touch(one${any})${any} {\n  ${random.pick(["if (one) one.a = 9;", "steps++;", "held = one;", "kept.push(one);", "if (one && steps++ > 3) delete one.a;"])}\n  return one;\n}`,
    `function show(value${any}, depth${number} = 0)${isTyped ? ": string" : ""} {`,
    '  if (typeof value === "function") return "function";',
    '  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);',
    '  if (depth > 3) return "deep";',
    '  return (Array.isArray(value) ? "[" : "{") + Object.keys(value).map(key => key + ":" + show(value[key], depth + 1)).join() + "}";',
    "}",
    `function plain(value${any})${any} {\n  return typeof value === "function" || (typeof value === "object" && value !== null) ? 1 : value;\n}`,
  ];
  for (let index = 0; index < makerCount; index++) {
    const from = ["x"];
    const bodies = [
      () => [`if (${condition(from)}) return ${nothing()};`, `return ${record(from)};`],
      () => [`return ${condition(from)} ? ${nothing()} : ${record(from)};`],
      () => [`return ${condition(from)} ? ${record(from)} : ${record(from)};`],
      () => [`let made${any} = null;`, `if (${condition(from)}) made = ${record(from)};`, ...(random.chance(0.4) ? [`else if (${condition(from)}) made = ${record(from)};`] : []), "return made;"], // prettier-ignore
      () => [
        `for (let at = 0; at < 3; at++) if (${condition(["x", "at"])}) return ${record(["x", "at"])};`,
        `return ${nothing()};`,
      ],
      () => [
        `switch (x % 4) {`,
        `  case 0:`,
        `    return ${record(from)};`,
        `  case 1:`,
        `    return ${nothing()};`,
        `  default:`,
        `    return ${record(from)};`,
        `}`,
      ],
      () => [`const made${any} = ${record(from)};`, `if (${condition(from)}) made.b = ${small(from)};`, "return made;"],
      () => [`if (${condition(from)}) throw ${record(from)};`, `return ${record(from)};`],
      () => [`return ${condition(from)} && ${record(from)};`],
      ...(index > 0 ? [() => [`return make${index - 1}(x) ${random.pick(["??", "||", "&&"])} ${record(from)};`], () => [`const one${any} = make${index - 1}(x);`, `return one ? ${random.pick(["one", record(from), "{ ...one, b: 5 }"])} : ${nothing()};`]] : []), // prettier-ignore
    ];
    lines.push(`function make${index}(x${any})${any} {`, ...indent(random.pick(bodies)()), "}");
  }
  // Classes whose methods of one name give such results, called through a list that holds several of them.
  const checkCount = random.chance(0.6) ? 2 + random.below(2) : 0;
  for (let index = 0; index < checkCount; index++) {
    const from = ["x", "this.limit"];
    const inner = random.pick([
      () => [`return ${condition(from)} ? ${nothing()} : ${record(from)};`],
      () => [`const one${any} = make${random.below(makerCount)}(x);`, `if (${random.pick(["!one", "one === null", "one && one.ok === false"])}) return ${random.pick(["one", nothing()])};`, `return ${random.pick(["one", record(from), "{ ok: true, value: one }"])};`], // prettier-ignore
      () => [`if (${condition(from)}) return ${isTyped ? "(this as any)" : "this"}.run(x - 1);`, `return ${record(from)};`].map(line => line.replace(".run(x - 1)", index > 0 ? ".inner?.run(x)" : ".limit")), // prettier-ignore
      () => [
        `let made${any} = null;`,
        `for (let at = 0; at < 2; at++) {`,
        `  if (${condition(["x", "at"])}) made = ${record(["x", "at"])};`,
        `  else if (made) made.a = at;`,
        "}",
        "return made;",
      ],
      ...(index > 0 ? [() => [`const one${any} = super.run(x);`, `return one ? ${random.pick(["one", record(from)])} : ${random.pick([nothing(), record(from)])};`]] : []), // prettier-ignore
    ])();
    const isHeir = index > 0 && (inner.some(line => /super\./.test(line)) || random.chance(0.4));
    lines.push(
      `class Check${index}${isHeir ? ` extends Check${index - 1}` : ""} {`,
      ...(isHeir
        ? []
        : [
            `  limit${number} = ${random.below(4)};`,
            `  inner${any} = ${index > 0 ? `new Check${index - 1}()` : "null"};`,
          ]),
      `  run(x${any})${any} {`,
      ...indent(indent(inner)),
      "  }",
      "}",
    );
  }
  if (checkCount)
    lines.push(
      `const checks${any} = [${Array.from({ length: 2 + random.below(3) }, () => `new Check${random.below(checkCount)}()`).join(", ")}${random.chance(0.3) ? `, { run: (x${any}) => (x > 2 ? null : { a: x }) }` : ""}];`,
      `function runAll(x${any})${any} {`,
      `  for (const check of checks) {`,
      `    const one${any} = check.run(x);`,
      `    ${random.pick(["if (one) return one;", "if (!one || one.ok === false) return { ok: false, at: check.limit };", "if (one?.a > 2) return one;"])}`,
      "  }",
      `  return ${random.pick(["null", "{ ok: true, value: x }"])};`,
      "}",
    );
  const functionCount = 1 + random.below(2);
  const calls: string[] = [];
  const readers = (atTop: boolean, index: number): string[] => {
    const results: string[] = [];
    const numbers = ["i"];
    const source = (): string =>
      random.pick([
        () => `make${random.below(makerCount)}(${random.pick(numbers)})`,
        () => `make${random.below(makerCount)}(${random.pick(numbers)})`,
        () => `${condition(numbers)} ? ${nothing()} : ${record(numbers)}`,
        () => `${condition(numbers)} ? ${record(numbers)} : ${record(numbers)}`,
        () => `${condition(numbers)} ? ${record(numbers)} : ${results.length ? random.pick(results) : "held"}`,
        () => `${results.length ? random.pick(results) : "held"} ${random.pick(["??", "||"])} ${record(numbers)}`,
        () => `${condition(numbers)} && ${record(numbers)}`,
        () => record(numbers),
        () => `list.find((one${any}) => one.a > ${random.pick(numbers)})`,
        () => `touch(${record(numbers)})`,
        ...(checkCount
          ? [
              () => `checks[${random.pick(numbers)} % checks.length].run(${random.pick(numbers)})`,
              () => `checks[${random.pick(numbers)} % checks.length].run(${random.pick(numbers)})`,
              () => `checks[0].run(${random.pick(numbers)})`,
              () => `runAll(${random.pick(numbers)})`,
              () => `new Check${random.below(checkCount)}().run(${random.pick(numbers)})`,
            ]
          : []),
      ])();
    const member = () => random.pick(["a", "a", "a", "b", "b", "ok", "value", "next", "size", "0", "1"]);
    const read = (name: string): string => {
      const key = member();
      const of = /\d/.test(key) ? `[${key}]` : `.${key}`;
      return random.pick([
        () => `${name}?.${/\d/.test(key) ? of : key}`,
        () => `(${name} && ${name}${of})`,
        () => `(${name} ? ${name}${of} : ${random.pick(["0", "-1", '"none"'])})`,
        () => `${name}?.${/\d/.test(key) ? of : key} ?? ${random.pick(["0", "i", '"no"'])}`,
        () => `(${name} || { a: 4 })${of}`,
        () => `${name}${of}`,
        () => `${name}?.next?.a`,
      ])();
    };
    const statement = (): string[] => {
      if (!results.length || random.chance(0.35)) {
        const name = `r${nameCount++}`;
        const made = random.pick([
          () => [`const ${name}${any} = ${source()};`],
          () => [`const ${name}${any} = ${source()};`],
          () => [`let ${name}${any} = null;`, `if (${condition(numbers)}) ${name} = ${source()};`],
          () => [`let ${name}${any} = ${source()};`, `if (${condition(numbers)}) ${name} = ${source()};`],
          () => [`let ${name}${any};`, "try {", `  ${name} = ${source()};`, "} catch (error) {", `  ${name} = ${random.pick(["error", "null", record(numbers)])};`, "}"], // prettier-ignore
          () => [
            `let ${name}${any} = ${source()};`,
            `for (let at = 0; at < 2; at++) if (${condition(["at", "i"])}) ${name} = ${source()};`,
          ],
        ])();
        results.push(name);
        return made;
      }
      const name = random.pick(results);
      return random.pick([
        () => [`total += plain(${read(name)});`],
        () => [`total += plain(${read(name)});`],
        () => [`text += show(${read(name)});`],
        () => [`if (${name}) total += plain(${name}.a);`],
        () => [`if (${name}) {`, `  ${random.pick([`${name}.a = i;`, `${name}.b = 2;`, `${name}.a = plain(${name}.a) + 1;`, `delete ${name}.b;`, `${name}.extra = i;`])}`, `  text += show(${name});`, "}"], // prettier-ignore
        () => [`const { a: a${nameCount} = 3, b: b${nameCount} } = ${name} ${random.pick(["??", "||"])} ${isTyped ? "({} as any)" : "{}"};`, `total += plain(a${nameCount}) + (plain(b${nameCount++}) ? 1 : 0);`], // prettier-ignore
        () => [`text += ${name} === ${random.pick([...results, "held", "null", "undefined"])} ? "=" : "!";`],
        () => [`carried = ${name};`],
        () => [`if (carried !== ${name}) text += show(carried);`, `carried = ${name};`],
        () => [`held = ${name};`],
        () => [`if (${condition(numbers)}) kept.push(${name});`],
        () => [`total += plain(touch(${name})?.a);`],
        () => [`text += show({ ...${name}, z: i });`],
        () => [`text += typeof ${name};`],
        () => [`if (${name} === null) ${random.pick(["continue;", "break;", "total += 1;"])}`],
        () => [`if (!${name}) ${random.pick(["continue;", "break;", 'text += "n";'])}`],
        () => [`text += ${name} instanceof Pair ? ${name}.sum() : "-";`],
        () => [`text += JSON.stringify(${name}) ?? "u";`],
      ])();
    };
    const body = Array.from({ length: 2 + random.below(5) }, statement);
    const loop = random.pick(["for (let i = 0; i < count; i++) {", "for (let i = 0; i < count; i++) {", "for (let i = count; i > 0; i--) {", "for (const i of [0, 1, 2, 3, 4, 5]) {"]); // prettier-ignore
    const inner = random.chance(0.2)
      ? ["for (let again = 0; again < 2; again++) {", ...indent(body.flat()), "}"]
      : body.flat();
    const looped = [loop, ...indent(inner), "}"];
    const tail = random.chance(0.3) ? ["total += plain(carried?.a);"] : [];
    const start = [
      `let total${any} = 0;`,
      'let text = "";',
      `let carried${any} = ${random.pick(["null", "undefined", "{ a: 1, b: 1 }", "new Pair(1, 2)"])};`,
      `const list${any} = [${Array.from({ length: 1 + random.below(3) }, () => `{ a: ${random.below(6)} }`).join(", ")}];`,
    ];
    if (atTop)
      return ["{", `  const count = ${1 + random.below(8)};`, ...indent([...start, "try {", ...indent([...looped, ...tail]), "} catch (error) {", `  text += "threw" + ((error${isTyped ? " as any" : ""})?.name ?? show(error));`, "}", "console.log(show(total), text.slice(0, 400), show(carried));"]), "}"]; // prettier-ignore
    const result = random.pick(["[total, text.slice(0, 400)]", "[total, text.slice(0, 400), carried]", "{ total, text: text.slice(0, 400), carried }"]); // prettier-ignore
    const form = random.pick(["function", "function", "function", "arrow", "generator", "async", "method"]);
    const counts = Array.from({ length: 1 + random.below(2) }, () => random.pick(["1", "3", "6", "12"]));
    const all = [...start, ...looped, ...tail];
    const guard = (call: string) => ["try {", `  console.log(show(${call}));`, "} catch (error) {", `  console.log("threw", (error${isTyped ? " as any" : ""})?.name ?? show(error));`, "}"]; // prettier-ignore
    for (const count of counts)
      calls.push(...guard(form === "generator" ? `[...work${index}(${count})]` : form === "async" ? `await work${index}(${count})` : form === "method" ? `Worker${index}.work(${count})` : `work${index}(${count})`)); // prettier-ignore
    if (form === "generator") return [`function* work${index}(count${number})${isTyped ? ": Generator<any>" : ""} {`, ...indent([...start, looped[0], "  yield carried;", ...looped.slice(1), ...tail, `yield ${result};`]), "}"]; // prettier-ignore
    if (form === "async") return [`async function work${index}(count${number})${isTyped ? ": Promise<any>" : ""} {`, ...indent([...start, looped[0], ...(random.chance(0.5) ? ["  await null;"] : []), ...looped.slice(1), ...tail, `return ${result};`]), "}"]; // prettier-ignore
    if (form === "arrow") return [`const work${index} = (count${number})${any} => {`, ...indent([...all, `return ${result};`]), "};"]; // prettier-ignore
    if (form === "method") return [`class Worker${index} {`, `  static work(count${number})${any} {`, ...indent(indent([...all, `return ${result};`])), "  }", "}"]; // prettier-ignore
    return [`function work${index}(count${number})${any} {`, ...indent([...all, `return ${result};`]), "}"];
  };
  for (let index = 0; index < functionCount; index++) lines.push(...readers(random.chance(0.25), index));
  lines.push(...calls, "console.log(steps, show(held), show(kept));");
  const ownNames =
    /\b(?:make\d|work\d|Worker\d|Check\d|checks|runAll|steps|kept|held|Pair|isWanted|touch|show|plain)\b/g;
  return {
    name: `${makerCount}-makers--${checkCount}-checks`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(ownNames, name => name + suffix) : line)),
  };
}
export const writeSceneOfOptionalResults = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeOptionalResults(random, isTypeScript, "printValue", "_" + n).lines;
