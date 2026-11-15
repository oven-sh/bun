// Writes programs of async functions, generators and async generators that call each other. For write-random-coroutine-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Async functions suspend always, sometimes or never, return or throw before or behind an await, and are awaited in try, in loops, in finally, or not at all. Other jobs of the microtask queue stand between them.
// Generators are made outside loops and taken inside, passed to other generators, delegated to, closed early by break, return() and throw(), and take default parameters that call functions.
// Each program notes every step in order and prints the notes at its end.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. A part of a program awaits at its top. */
export function writeCoroutines(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const any = isTyped ? ": any" : "";
  const indent = (lines: string[]) => lines.map(line => "  " + line);
  const asyncCount = 2 + random.below(3);
  const generatorCount = 1 + random.below(3);
  const hasAsyncGenerator = random.chance(0.35);
  let jobCount = 0;
  let nameCount = 0;

  const job = () => {
    const name = `job ${jobCount++}`;
    return random
      .pick([
        `queueMicrotask(() => note("${name}"));`,
        `Promise.resolve().then(() => note("${name}"));`,
        `Promise.reject(new Error("${name}")).catch(error => note(error.message));`,
        `(async () => {\n  await null;\n  note("${name}");\n})();`,
      ])
      .split("\n");
  };
  const condition = (value: string) =>
    random.pick([`${value} > 1`, `${value} === 2`, `${value} < 2`, `${value} % 2 === 0`, `${value} >= 3`]);
  /** A call of an async function that stands above function `index`. */
  const callAsync = (index: number, value: string) =>
    index === 0
      ? random.pick([
          "null",
          "undefined",
          value,
          `Promise.resolve(${value})`,
          `new Promise(resolve => resolve(${value}))`,
        ])
      : `work${random.below(index)}(${random.pick([value, `${value} - 1`, `${value} + 1`, ""])})`;
  const awaiting = (index: number, value: string): string[] => {
    const call = callAsync(index, value);
    switch (random.below(9)) {
      case 0:
        return [`await ${call};`];
      case 1:
        return [`total += Number(await ${call}) || 0;`];
      case 2:
        return [
          "try {",
          `  note("in try " + (await ${call}));`,
          "} catch (error) {",
          `  note("caught " + (error${isTyped ? " as any" : ""}).message);`,
          ...(random.chance(0.3) ? indent(awaiting(index, value)) : []),
          ...(random.chance(0.5)
            ? [
                "} finally {",
                `  note("finally");`,
                ...(random.chance(0.4) ? [`  await ${callAsync(index, value)};`] : []),
              ]
            : []),
          "}",
        ];
      case 3:
        return [
          "try {",
          `  await ${call};`,
          `  note("after");`,
          "} catch {",
          ...(random.chance(0.4) ? indent(job()) : ["  total += 10;"]),
          "}",
        ];
      case 4:
        return [
          `for (let i = 0; i < ${random.pick(["2", "3", value])} && i < 4; i++) {`,
          `  note("turn " + i);`,
          `  await ${index === 0 ? "i" : callAsync(index, "i")};`,
          "}",
        ];
      case 5:
        return [
          `const all${nameCount++} = await Promise.${random.pick(["all", "allSettled", "race"])}([${callAsync(index, value)}, ${callAsync(index, value)}]);`,
          `note(JSON.stringify(all${nameCount - 1}));`,
        ].map(line => line);
      case 6:
        return [
          `${index === 0 ? "Promise.resolve(" + value + ")" : call}.then(result => note("then " + result), error => note("failed " + error.message));`,
        ];
      case 7:
        return [`if (${condition(value)}) await ${call};`, `note("behind");`];
      default:
        return [
          `const promise${nameCount++} = ${index === 0 ? `Promise.resolve(${value})` : call};`,
          ...job(),
          "try {",
          `  note("late " + (await promise${nameCount - 1}));`,
          "} catch (error) {",
          `  note("late " + (error${isTyped ? " as any" : ""}).message);`,
          "}",
        ];
    }
  };
  const generatorUse = (from: string): string[] => {
    const turn = "t" + nameCount++;
    const value = "v" + nameCount++;
    switch (random.below(9)) {
      case 0:
        return [
          `for (const ${value} of ${from}) {`,
          `  note("each " + ${value});`,
          ...(random.chance(0.4) ? [`  if (${value} > 1) break;`] : []),
          "}",
        ];
      case 1:
        return [`note([...${from}].join());`];
      case 2:
        return [
          `const taken${nameCount++}${any} = ${from};`,
          `for (let ${turn} = 0; ${turn} < ${random.pick(["2", "3", "4"])}; ${turn}++) {`,
          `  const step${any} = taken${nameCount - 1}.next(${turn});`,
          `  note(step.value + " " + step.done);`,
          "}",
        ];
      case 3: {
        // Made outside of the loop, taken inside.
        const name = "outer" + nameCount++;
        return [
          `const ${name}${any} = ${from};`,
          `for (let ${turn} = 0; ${turn} < 3; ${turn}++) {`,
          ...indent(
            random.pick([
              [
                `for (const ${value} of ${name}) {`,
                `  note(${turn} + ":" + ${value});`,
                `  ${random.pick(["break;", "if (total++ > 2) break;", "continue;"])}`,
                "}",
              ],
              [
                `for (const ${value} of steps${random.below(generatorCount)}(${turn}, ${name})) note(${turn} + "/" + ${value});`,
              ],
              [`const ${value}${any} = ${name}.next();`, `note(${turn} + "=" + ${value}.value);`],
              [`const [${value}] = ${name};`, `note(${turn} + "[" + ${value});`],
            ]),
          ),
          "}",
        ];
      }
      case 4:
        return [
          `const [first${nameCount}, second${nameCount}] = ${from};`,
          `note(first${nameCount} + "," + second${nameCount++});`,
        ];
      case 5:
        return [`note(Array.from(${from}, ${value} => ${value} * 2).join("-"));`];
      case 6: {
        const name = "closed" + nameCount++;
        return [
          `const ${name}${any} = ${from};`,
          `note(JSON.stringify(${name}.next()));`,
          "try {",
          `  note(JSON.stringify(${name}.${random.pick(["return(7)", 'throw(new Error("thrown in"))', "next()", "return()"])}));`,
          "} catch (error) {",
          `  note("closed " + (error${isTyped ? " as any" : ""}).message);`,
          "}",
          `note(JSON.stringify(${name}.next()));`,
        ];
      }
      case 7:
        return [
          `for (let ${turn} = 0; ${turn} < 2; ${turn}++) for (const ${value} of ${from}) note(${turn} + "." + ${value});`,
        ];
      default:
        return [
          `const map${nameCount++} = new Map([...${from}].map((${value}, index) => [index, ${value}]));`,
          `note([...map${nameCount - 1}].join(";"));`,
        ];
    }
  };
  const generatorCall = (value: string): string => {
    const index = random.below(generatorCount);
    const inner = random.chance(0.35)
      ? `, steps${random.below(generatorCount)}(${random.pick([value, "2"])})`
      : random.chance(0.2)
        ? ", [8, 9]"
        : "";
    return `steps${index}(${inner ? random.pick([value, "undefined", "2"]) : random.pick([value, value, "", "3"])}${inner})`;
  };

  const lines: string[] = [
    `const notes${isTyped ? ": string[]" : ""} = [];`,
    `const note = (text${any}) => {\n  notes.push(String(text));\n};`.replace(
      "{\n  notes",
      "{\n  if (notes.length < 400) notes",
    ),
    "let total = 0;",
    "let defaults = 0;",
    `function defaultOf(value${any}) {\n  note("default " + value + " " + defaults++);\n  return value;\n}`,
  ];
  // Generators. The second parameter is anything that can be walked.
  for (let index = 0; index < generatorCount; index++) {
    const parameter = random.pick([
      `count${any} = defaultOf(${1 + random.below(3)})`,
      `count${any} = ${1 + random.below(3)}`,
      `count${any} = 2`,
    ]);
    const inner = `inner${any} = ${random.pick(["[]", "[5]", "[]", "defaultOf([4])"])}`;
    const body: string[] = [];
    const yields = () =>
      random.pick([
        ["yield count;"],
        [`for (let i = 0; i < count && i < 4; i++) yield i;`],
        ["yield* inner;"],
        ["for (const each of inner) yield each + 10;"],
        [`const sent${nameCount} = yield count * 2;`, `note("sent " + sent${nameCount++});`],
        ["try {", "  yield 1;", "  yield* inner;", "} finally {", `  note("closing ${index}");`, "}"],
        [
          `try {`,
          "  yield count + 1;",
          "} catch (error) {",
          `  note("inside " + (error${isTyped ? " as any" : ""}).message);`,
          "  yield -1;",
          "}",
        ],
        [`if (${condition("count")}) return 100;`],
        [`note("in ${index} " + count);`],
        [
          "let i = 0;",
          "while (i < count && i < 4) {",
          "  const given = yield i++;",
          "  if (given === 1) i++;",
          "}",
        ].map(line => line.replaceAll(/\b(i|given)\b/g, name => name + nameCount)),
      ] as string[][]);
    for (let part = 1 + random.below(3); part >= 0; part--) {
      body.push(...yields());
      nameCount++;
    }
    if (random.chance(0.4)) body.push(`return ${random.pick(["count", '"end"', "inner"])};`);
    lines.push(
      `function* steps${index}(${parameter}, ${inner})${isTyped ? ": Generator<any, any, any>" : ""} {`,
      ...indent(body),
      "}",
    );
  }
  for (let index = 0; index < asyncCount; index++) {
    const parameter = random.chance(0.3)
      ? `value${any} = defaultOf(${random.below(4)})`
      : `value${any} = ${random.below(4)}`;
    const body: string[] = [`note("work${index} " + value);`];
    for (let part = random.below(4); part >= 0; part--)
      switch (random.below(8)) {
        case 0:
          body.push(`if (${condition("value")}) throw new Error("work${index}");`);
          break;
        case 1:
          body.push(
            `if (${condition("value")}) return ${random.pick(["value", callAsync(index, "value"), `await ${callAsync(index, "value")}`, "undefined"])};`,
          );
          break;
        case 2:
          body.push(...job());
          break;
        case 3:
          body.push(...generatorUse(generatorCall("value")));
          break;
        default:
          body.push(...awaiting(index, "value"));
      }
    body.push(`return ${random.pick(["value", "value + 1", callAsync(index, "value"), '"done"'])};`);
    const name = "work" + index;
    const head = random.pick(["function", "function", "arrow", "method"]);
    lines.push(
      ...(head === "function"
        ? [`async function ${name}(${parameter})${isTyped ? ": Promise<any>" : ""} {`, ...indent(body), "}"]
        : head === "arrow"
          ? [`const ${name} = async (${parameter})${isTyped ? ": Promise<any>" : ""} => {`, ...indent(body), "};"]
          : [
              `const holder${index} = {`,
              `  async ${name}(${parameter})${isTyped ? ": Promise<any>" : ""} {`,
              ...indent(indent(body)),
              "  },",
              "};",
              `const ${name} = (value${isTyped ? "?: any" : ""}) => holder${index}.${name}(value);`,
            ]),
    );
  }
  if (hasAsyncGenerator)
    lines.push(
      `async function* stream(count${any} = 2)${isTyped ? ": AsyncGenerator<any, any, any>" : ""} {`,
      ...indent([
        `for (let i = 0; i < count && i < 3; i++) {`,
        ...indent([
          random.pick([
            "yield i;",
            `yield ${callAsync(asyncCount, "i")};`,
            "await null;\n    yield i;",
            "yield Promise.resolve(i);",
          ]),
          ...(random.chance(0.4) ? [`note("stream " + i);`] : []),
        ]),
        "}",
        random.pick(["yield* steps0(1);", 'note("stream ends");', `if (count > 2) throw new Error("stream");`]),
      ]),
      "}",
    );
  const body: string[] = [];
  for (let part = 2 + random.below(4); part > 0; part--)
    switch (random.below(hasAsyncGenerator ? 8 : 7)) {
      case 0:
        body.push(...job());
        break;
      case 1:
      case 2:
        body.push(...generatorUse(generatorCall("value")));
        break;
      case 7:
        body.push(
          "try {",
          `  for await (const each of stream(value)) {`,
          `    note("streamed " + each);`,
          ...(random.chance(0.4) ? ["    if (each === 1) break;"] : []),
          "  }",
          "} catch (error) {",
          `  note("stream failed " + (error${isTyped ? " as any" : ""}).message);`,
          "}",
        );
        break;
      default:
        body.push(...awaiting(asyncCount, "value"));
    }
  lines.push(
    `async function run(value${any})${isTyped ? ": Promise<any>" : ""} {`,
    ...indent(body),
    "  return total;",
    "}",
  );
  const ends = `.then(result => note("run ends " + result), error => note("run fails " + error.message))`;
  lines.push(
    ...(random.chance(0.6)
      ? [`const beside = run(${random.pick(["1", "2", "0"])})${ends};`]
      : ["const beside = null;"]),
    ...(random.chance(0.5) ? job() : []),
    random.chance(0.5)
      ? `for (let round = 0; round < ${random.pick(["2", "3"])}; round++) await run(round)${ends};`
      : `await run(${random.pick(["3", "2", 'JSON.parse("2")'])})${ends};`,
    "await beside;",
    "for (let i = 0; i < 20; i++) await null;",
    `${print}(notes.join("|"));`,
    `${print}("total", total);`,
  );
  const ownNames = /\b(?:(?:work|steps|holder)\d|notes|note|total|defaults|defaultOf|stream|run|beside)\b/g;
  return {
    name: `${asyncCount}-async--${generatorCount}-generators${hasAsyncGenerator ? "--stream" : ""}`,
    lines: lines.flatMap(line => line.split("\n")).map(line => line.replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfCoroutines = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeCoroutines(random, isTypeScript, "printValue", "_" + n).lines;
