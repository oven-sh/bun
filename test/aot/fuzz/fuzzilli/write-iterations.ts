// Writes programs that walk iterators. For write-random-iteration-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Iterators are objects with next, return and throw, classes, generators, lists, maps, sets, strings, views, iterator helpers and lookalikes whose results lack a member or count how often they are asked.
// They are walked by for-of with early exits, by spread, by patterns with defaults and rests, by yield*, by hand, by for await and by built-ins, while what is walked grows, shrinks, throws or is closed.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeIterations(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const number = isTyped ? ": number" : "";
  let nameCount = 0;
  const one = () =>
    random.pick([
      "i",
      "i",
      "i * 2",
      "i + 1",
      '"v" + i',
      "[i, i + 1]",
      "{ a: i, b: 2 }",
      "i > 2 ? undefined : i",
      "0.5 + i",
      "null",
    ]);
  const lines: string[] = [
    `const told${isTyped ? ": any[]" : ""} = [];`,
    `let shared${any} = [1, 2, 3];`,
    `const sharedSet${isTyped ? ": Set<any>" : ""} = new Set([2, 3, 5, 7]);`,
    `const sharedMap${isTyped ? ": Map<any, any>" : ""} = new Map([["a", 1], ["b", 2], ["c", 1]]);`,
    `function note(value${any})${any} {`,
    "  if (told.length < 80) told.push(show(value));",
    "  return value;",
    "}",
    `function show(value${any}, depth${number} = 0)${isTyped ? ": string" : ""} {`,
    '  if (typeof value === "function") return "function";',
    '  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);',
    '  if (depth > 3) return "deep";',
    '  return (Array.isArray(value) ? "[" : "{") + Object.keys(value).slice(0, 20).map(key => key + ":" + show(value[key], depth + 1)).join() + "}";',
    "}",
  ];
  const makers: string[] = [];
  const makerCount = 2 + random.below(3);
  for (let index = 0; index < makerCount; index++) {
    const name = `make${index}`;
    makers.push(name);
    const limit = 1 + random.below(5);
    const closing = random.chance(0.5)
      ? [
          `    return(value${any}) {`,
          `      note("closed");`,
          `      ${random.pick(["return { done: true, value };", "i = 99;\n      return {};", 'if (i === 2) throw new Error("closing");\n      return { done: true, value: undefined };', "return { value: 1 };"])}`,
          "    },",
        ]
      : [];
    const result = random.pick([
      `i < ${limit} ? { done: false, value: ${one()} } : { done: true, value: undefined }`,
      `i < ${limit} ? { value: ${one()}, done: false } : { value: "end", done: true }`,
      `i < ${limit} ? { value: ${one()} } : { done: true }`,
      `({ done: i >= ${limit}, value: ${one()} })`,
      `({ get done() { note("done?"); return i >= ${limit}; }, get value() { return ${one()}; } })`,
    ]);
    const body = random.pick([
      () => [`function ${name}(count${any})${any} {`, "  let i = 0;", "  return {", ...(random.chance(0.85) ? ["    [Symbol.iterator]() {", "      return this;", "    },"] : []), "    next() {", `      ${random.pick(["", "", "", 'if (i === 3) throw new Error("next");'])}`, `      const result${any} = ${result};`, "      i++;", "      return result;", "    },", ...closing, "  };", "}"], // prettier-ignore
      () => [`class Walker${index} {`, `  i${number} = 0;`, `  end${any};`, `  constructor(end${any}) {`, "    this.end = end;", "  }", `  [Symbol.iterator]()${any} {`, random.pick(["    return this;", "    return new Walker" + index + "(this.end);"]), "  }", `  next()${any} {`, "    const i = this.i++;", `    return i < this.end ? { done: false, value: ${one()} } : { done: true, value: undefined };`, "  }", ...(random.chance(0.4) ? [`  return()${any} {`, '    note("left");', "    return { done: true, value: undefined };", "  }"] : []), "}", `function ${name}(count${any})${any} {`, `  return new Walker${index}(count);`, "}"], // prettier-ignore
      () => [`function* ${name}(count${any})${isTyped ? ": any" : ""} {`, ...(random.chance(0.4) ? ["  try {", `    for (let i = 0; i < count; i++) ${random.pick(["yield " + one() + ";", "note(yield " + one() + ");"])}`, "  } finally {", '    note("finally");', "  }"] : [`  for (let i = 0; i < count; i++) ${random.pick(["yield " + one() + ";", "note(yield " + one() + ");", "if (i % 2) yield " + one() + ";"])}`]), ...(random.chance(0.4) ? ['  return "last";'] : []), "}"], // prettier-ignore
      () => [`function ${name}(count${any})${any} {`, `  const list${any} = [];`, `  for (let i = 0; i < count; i++) list.push(${one()});`, `  return ${random.pick(["list", "list", "new Set(list)", "new Map(list.map((each" + any + ", at" + any + ") => [at, each]))", "list.values()", "list.entries()", "new Set(list).entries()", "new Map(list.entries()).entries()", "list[Symbol.iterator]()", "Iterator.from(list)", "sharing(list)", "handing(list.values())", "handing(new Set(list).entries())"])};`, "}"], // prettier-ignore
      () => [`function ${name}(count${any})${any} {`, `  return ${random.pick(['"text".slice(0, count)', "new Uint8Array([1, 2, 255]).subarray(0, count)", "new Map([[1, 2], [3, 4]]).keys()", "shared", "shared.keys()", '"é😀a"', "new Float64Array([0.5, 2])"])};`, "}"], // prettier-ignore
      ...(index > 0
        ? [
            () => [`function* ${name}(count${any})${isTyped ? ": any" : ""} {`, `  ${random.pick([`yield* make${index - 1}(count);`, `const got${any} = yield* make${index - 1}(count);\n  note(got);`, `for (const each of make${index - 1}(count)) yield each;`, `yield* make${index - 1}(1);\n  yield* make${index - 1}(count);`])}`, "}"], // prettier-ignore
            () => [`function ${name}(count${any})${any} {`, `  const inner${any} = Iterator.from(make${index - 1}(count));`, `  return inner.${random.pick([`map((each${any}) => note(each))`, `filter((each${any}) => each !== 1)`, "take(2)", "drop(1)", `flatMap((each${any}) => [each, each])`, `take(3).map((each${any}, at${any}) => at)`])};`, "}"], // prettier-ignore
          ]
        : []),
    ])();
    lines.push(...body.filter(line => line.trim() !== ""));
  }
  const source = (count = "count") => {
    const maker = random.pick(makers);
    return random.pick([`${maker}(${count})`, `${maker}(${count})`, `${maker}(${count})`, `${maker}(${random.pick(["0", "1", "3", "5"])})`, "shared", "kept"]); // prettier-ignore
  };
  /** An iterator to step by hand: out of anything, or straight from a built-in, whose steps a compiler knows. */
  const byHand = (): string =>
    random.chance(0.45)
      ? `stepper(${source()})`
      : random.pick(["sharedSet.entries()", "sharedSet.values()", "sharedMap.entries()", "sharedMap.keys()", "sharedMap.values()", "shared.entries()", "shared.values()", "new Set([1, 2, 2, 3]).entries()", "new Map([[1, 2], [3, 4]]).entries()", '"text"[Symbol.iterator]()', "[1, 1, 2, 2].values()", "[[1], [1], [2]].values()", "sharedSet[Symbol.iterator]()"]); // prettier-ignore
  const functionCount = 1 + random.below(3);
  const calls: string[] = [];
  for (let index = 0; index < functionCount; index++) {
    const form = random.pick(["function", "function", "function", "arrow", "generator", "async"]);
    const out = (text: string) =>
      random.pick([`note(${text});`, `total += plain(${text});`, `total += plain(${text});`, `last = ${text};`]);
    const inside = (name: string): string[] => {
      const lines: string[] = [out(name)];
      if (random.chance(0.35)) lines.push(`if (${random.pick([`turns++ > ${1 + random.below(4)}`, `${name} === ${random.below(4)}`, `plain(${name}) > 2`])}) ${random.pick(["break;", "break;", "continue;", form === "generator" ? "return;" : "return total;", 'throw new Error("body");'])}`); // prettier-ignore
      if (random.chance(0.2)) lines.push(random.pick(["if (shared.length < 8) shared.push(turns);", "shared.pop();", "shared = [...shared, 9].slice(0, 6);", "shared.length = 2;", "if (turns < 4) sharedSet.add(turns + 20);", "sharedSet.delete(3);", "sharedMap.set(\"d\", turns);"])); // prettier-ignore
      // What an iterator hands out is compared with what it handed out before.
      if (random.chance(0.25))
        lines.push(
          random.pick([
            `if (${name} !== last) total += 1;`,
            `if (first === ${name}) total += 2;`,
            `first ??= ${name};`,
            `if (first !== ${name}) first = ${name};`,
          ]),
        );
      if (form === "generator" && random.chance(0.3)) lines.push(`yield ${name};`);
      if (form === "async" && random.chance(0.3)) lines.push("await null;");
      return lines;
    };
    const walk = (depth: number): string[] => {
      const name = `each${nameCount++}`;
      return random.pick([
        () => [
          `for (const ${name} of ${source()}) {`,
          ...indent([...inside(name), ...(depth > 0 && random.chance(0.3) ? walk(depth - 1) : [])]),
          "}",
        ],
        () => [`for (const ${name} of ${source()}) {`, ...indent(inside(name)), "}"],
        () => [`for (const ${name} of ${source()}) {`, ...indent(inside(name)), "}"],
        () => [
          `for (const [${name}, with${name} = 7] of ${source()}) {`,
          ...indent([out(name), out("with" + name)]),
          "}",
        ],
        () => [`for (const { a: ${name} = 5 } of ${source()}) ${out(name)}`],
        () => [
          `const [${name}, second${name} = 3, ...rest${name}]${isTyped ? ": any" : ""} = ${source()};`,
          out(name),
          out(`second${name}`),
          out(`rest${name}.length`),
        ],
        () => [`const [, ${name}]${isTyped ? ": any" : ""} = ${source()};`, out(name)],
        () => [
          `let ${name}${any}, other${name}${any};`,
          `[${name}, other${name}] = ${source()};`,
          `[${name}, other${name}] = [other${name}, ${name}];`,
          out(name),
        ],
        () => [
          `const ${name}${any} = [...${source()}];`,
          out(`${name}.length`),
          ...(random.chance(0.5) ? [out(`${name}[1]`)] : []),
        ],
        () => [`const ${name}${any} = [0, ...${source()}, ...${source()}];`, out(`${name}.length`)],
        () => [out(`count3(...${source()})`)],
        () => [`const ${name}${any} = ${source()}[Symbol.iterator]?.();`, `for (let step${any} = ${name}.next(); !step.done; step = ${name}.next(${random.pick(["", "turns"])})) {`, ...indent([out("step.value"),
            ...(random.chance(0.4) ? [random.pick(["if (step.value !== first) total += 1;", "first ??= step.value;", "if (step.value === last) total += 3;"])] : []), ...(random.chance(0.4) ? [random.pick(["if (step.value !== first) total += 1;", "first ??= step.value;", "if (step.value === last) total += 3;"])] : []), `if (turns++ > 5) { ${name}.return?.(1); break; }`]), "}"], // prettier-ignore
        () => [`const ${name}${any} = ${source()}[Symbol.iterator]?.();`, "while (true) {", `  const { value, done }${any} = ${name}.next();`, "  if (done) break;", ...indent([out("value"), ...(random.chance(0.4) ? [random.pick(["if (value !== first) total += 1;", "first ??= value;", "if (value === last) total += 3;"])] : [])]), "}"], // prettier-ignore
        () => [out(`Array.from(${source()}${random.chance(0.5) ? `, (one${any}, at${any}) => at` : ""}).length`)],
        () => [out(`new Set(${source()}).size`)],
        // By hand: groups of equal values, pairs, a look ahead, a kept result, values handed in.
        () => {
          const [it, r] = [`it${name}`, `r${name}`];
          return [
            `const ${it}${any} = ${byHand()};`,
            `let ${r}${any} = ${it}.next();`,
            `outer${name}: while (!${r}.done && turns++ < 30) {`,
            `  const begun${any} = ${r}.value;`,
            "  let same = 0;",
            `  while (!${r}.done && turns++ < 30) {`,
            `    if (${r}.value ${random.pick(["!==", "!=="])} begun) ${random.pick([`continue outer${name};`, "break;"])}`,
            "    same++;",
            ...indent(indent([out(`${r}.value`), ...(random.chance(0.3) ? [`if (saved === ${r}) total += 5;`] : [])])),
            `    ${r} = ${it}.next();`,
            "  }",
            "  total += same;",
            ...(random.chance(0.3) ? [`  ${r} = ${it}.next();`] : []),
            "}",
          ];
        },
        () => [`const it${name}${any} = ${byHand()};`, `const by${name}${any} = ${byHand()};`, "for (let at = 0; at < 6; at++) {", `  const [left, right]${any} = [it${name}.next(), by${name}.next()];`, `  if (left.done ${random.pick(["||", "&&"])} right.done) break;`, ...indent([out("left.value"), out("right.value")]), `  ${random.pick(["saved = left;", "if (left.value === right.value) total += 4;", "kept2.push(left);"])}`, "}"], // prettier-ignore
        () => [`const it${name}${any} = ${byHand()};`, `let ahead${name}${any} = it${name}.next();`, `while (!ahead${name}.done && turns++ < 20) {`, `  const now${any} = ahead${name};`, `  ahead${name} = it${name}.next(${random.pick(["", "now.value"])});`, ...indent([out("now.value"), `if (now ${random.pick(["===", "!=="])} ahead${name}) total += 1;`]), "}"], // prettier-ignore
        () => [`const it${name}${any} = ${byHand()};`, `let r${name}${any};`, random.pick([`while (turns++ < 20 && !(r${name} = it${name}.next(turns)).done) {`, `for (; turns++ < 20 && (r${name} = it${name}.next()).done !== true; ) {`]), ...indent([out(`r${name}.value`), random.pick([`saved = r${name};`, `if (saved === r${name}) total += 2;`, `kept2.push(r${name});`, `if (turns === 4) it${name}.return?.(7);`])]), "}", out(`r${name}?.value`)], // prettier-ignore
        () => [`const it${name}${any} = ${byHand()};`, `let r${name}${any} = null;`, "do {", `  r${name} = it${name}.next();`, ...indent([out(`(r${name} ?? {}).value`)]), `} while (!r${name}.done && turns++ < 12);`], // prettier-ignore
        () => [out(`drained(${byHand()}, ${1 + random.below(5)})`)],
        () => [out(`Math.max(...${source()})`)],
        () => [`const ${name}${any} = Iterator.from(${source()});`, out(`${name}.${random.pick(["toArray().length", `reduce((sum${any}, one${any}) => sum + plain(one), 0)`, `some((one${any}) => one === 2)`, `find((one${any}) => one > 0)`, `forEach(note)`, "take(2).toArray()", "drop(1).next().value"])}`)], // prettier-ignore
        ...(form === "generator"
          ? [() => [`yield* ${source()};`], () => [`const ${name}${any} = yield* ${source()};`, out(name)]]
          : []),
        ...(form === "async" ? [() => [`for await (const ${name} of ${source()}) {`, ...indent(inside(name)), "}"], () => [out(`(await Promise.all([...${source()}])).length`)]] : []), // prettier-ignore
      ])();
    };
    const statement = (): string[] => {
      const made = walk(1);
      if (random.chance(0.25))
        return [
          "try {",
          ...indent(made),
          "} catch (error) {",
          `  note((error${isTyped ? " as any" : ""})?.name);`,
          "}",
        ];
      return made;
    };
    const body = Array.from({ length: 1 + random.below(3) }, statement).flat();
    const loops = random.below(10);
    const once = (inner: string[], name: string) => [
      `for (let ${name} = 0; ${name} < 2; ${name}++) {`,
      ...indent(inner),
      "}",
    ];
    const looped = loops < 6 ? body : loops < 8 ? once(body, "round") : once(once(body, "again"), "round");
    const text = [
      `let total${any} = 0;`,
      "let turns = 0;",
      `let last${any};`,
      `let first${any};`,
      `const kept${any} = ${random.pick(makers)}(count);`,
      ...looped,
    ];
    const head = `(count${any})`;
    const ends =
      form === "generator" ? ["yield total;", "yield show(last);"] : ['return total + "|" + turns + "|" + show(last);'];
    if (form === "generator")
      lines.push(`function* work${index}${head}${isTyped ? ": any" : ""} {`, ...indent([...text, ...ends]), "}");
    else if (form === "async")
      lines.push(
        `async function work${index}${head}${isTyped ? ": Promise<any>" : ""} {`,
        ...indent([...text, ...ends]),
        "}",
      );
    else if (form === "arrow")
      lines.push(`const work${index} = ${head}${any} => {`, ...indent([...text, ...ends]), "};");
    else lines.push(`function work${index}${head}${any} {`, ...indent([...text, ...ends]), "}");
    for (let count = 1 + random.below(3); count > 0; count--) {
      const given = random.pick(["0", "1", "2", "3", "5"]);
      const call = form === "generator" ? `[...work${index}(${given})].map(each => show(each))` : form === "async" ? `await work${index}(${given})` : `work${index}(${given})`; // prettier-ignore
      calls.push("try {", `  console.log(show(${call}));`, "} catch (error) {", `  console.log("threw", (error${isTyped ? " as any" : ""})?.name);`, "}", "shared = [1, 2, 3];"); // prettier-ignore
    }
  }
  lines.push(
    `let saved${any} = null;`,
    `const kept2${any} = [];`,
    `function stepper(from${any})${any} {`,
    '  return typeof from?.next === "function" ? from : from[Symbol.iterator]();',
    "}",
    `function sharing(list${any})${any} {`,
    "  let at = 0;",
    `  const one${any} = { value: undefined, done: false };`,
    "  return {",
    "    [Symbol.iterator]() {",
    "      return this;",
    "    },",
    "    next() {",
    "      one.value = list[at++];",
    "      one.done = at > list.length;",
    "      saved = one;",
    "      return one;",
    "    },",
    "  };",
    "}",
    `function handing(it${any})${any} {`,
    "  return {",
    "    [Symbol.iterator]() {",
    "      return this;",
    "    },",
    `    next(value${isTyped ? "?: any" : ""}) {`,
    "      return (saved = it.next(value));",
    "    },",
    "  };",
    "}",
    `function drained(it${any}, most${any})${any} {`,
    "  let total = 0;",
    `  for (let r${any} = it.next(); !r.done && most-- > 0; r = it.next()) total += plain(r.value);`,
    "  return total;",
    "}",
    `function plain(value${any})${any} {\n  return typeof value === "number" ? value : typeof value === "string" ? value.length : value ? 1 : 0;\n}`,
    `function count3(a${isTyped ? "?: any" : ""}, b${isTyped ? "?: any" : ""}, ...more${isTyped ? ": any[]" : ""})${any} {\n  return plain(a) + plain(b) + more.length;\n}`,
    ...calls,
    "console.log(told.join(), show(shared), show(saved), kept2.length);",
  );
  const ownNames =
    /\b(?:make\d|work\d|Walker\d|told|sharedSet|sharedMap|shared|note|show|plain|count3|saved|kept2|stepper|sharing|handing|drained)\b/g;
  return {
    name: `${makerCount}-makers--${functionCount}-walks`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(ownNames, name => name + suffix) : line)),
  };
}
export const writeSceneOfIterations = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeIterations(random, isTypeScript, "printValue", "_" + n).lines;
