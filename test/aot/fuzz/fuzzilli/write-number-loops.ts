// Writes programs of functions that compute with numbers in nested loops. For write-random-number-loop-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Loops count up or down, by whole numbers, fractions or decrements inside a condition, over lists of the file, of the function or of a parameter. Sums stand in locals, in variables of the file, in fields or in elements.
// Expressions mix shifts, bitwise operators, comparisons, conversions, Math functions and reads of lists under constant and computed keys. Values are whole, fractional, negative zero, huge or NaN, and some come out of JSON.
// Each program prints every result and what the lists and variables hold at its end.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeNumberLoops(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const number = isTyped ? ": number" : "";
  const any = isTyped ? ": any" : "";
  const list = isTyped ? ": any[]" : "";
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const constant = () =>
    random.pick([
      "0",
      "1",
      "1",
      "2",
      "3",
      "7",
      "-1",
      "0.5",
      "1.5",
      "0.25",
      "2147483647",
      "-2147483648",
      "4294967295",
      "2 ** 32",
      "-0",
      "NaN",
      "1e21",
    ]);
  const small = () => random.pick(["0", "1", "2", "3"]);
  const values = () =>
    Array.from({ length: 2 + random.below(5) }, () =>
      random.pick(["1", "2", "3", "4", "0", "5", "0.5", "-1", "7", "2.5"]),
    ).join(", ");
  const listOf = () => {
    const text = values();
    return random.pick([
      `[${text}]`,
      `[${text}]`,
      `JSON.parse("[${text}]")`,
      `Array.from([${text}])`,
      `[${text}, , 2]`,
      `new Float64Array([${text}])`,
      `new Uint8Array([${text}, 9, 8])`,
      `new Int32Array([${text}])`,
      `Object.create([${text}])`,
      `new Array(4).fill(${small()})`,
      "[]",
    ]);
  };
  const functionCount = 1 + random.below(3);
  const fileLists = Array.from({ length: 1 + random.below(2) }, (_, index) => "table" + index);
  const lines: string[] = [
    ...fileLists.map(name => `const ${name}${any} = ${listOf()};`),
    `let sum${number} = 0;`,
    `const state${any} = { count: ${small()}, last: ${constant()}, more: "m" };`,
    `function show(value${any})${any} {`,
    '  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "[" + Array.prototype.map.call(value.length > 99 ? Object.entries(value) : value, show).join() + "]" : String(value);',
    "}",
  ];
  let nameCount = 0;
  for (let index = 0; index < functionCount; index++) {
    const locals: string[] = [];
    const lists: string[] = [...fileLists];
    const counters: string[] = [];
    const parameters = ["a", "b"].slice(0, 1 + random.below(2));
    const takesList = random.chance(0.35);
    if (takesList) lists.push("given");
    const variable = () =>
      random.pick([...locals, ...locals, ...parameters, ...counters, ...counters, "sum", "state.count"]);
    const expression = (depth: number): string => {
      if (depth <= 0) return random.chance(0.65) ? variable() : constant();
      const sub = () => expression(depth - 1);
      switch (random.below(13)) {
        case 0:
        case 1:
          return `${sub()} + ${sub()}`;
        case 2:
          return `${sub()} - ${sub()}`;
        case 3:
          return `${sub()} * ${random.pick(["2", "0.5", "31", sub()])}`;
        case 4:
          return `(${sub()} ${random.pick(["|", "&", "^"])} ${random.pick(["0", "1", "255", sub()])})`;
        case 5:
          return `(${sub()} ${random.pick(["<<", ">>", ">>>"])} ${random.pick(["0", "1", "2", "31", variable()])})`;
        case 6:
          return random.pick([`+${variable()}`, `-(${sub()})`, `~${variable()}`, `(${variable()} || ${small()})`]);
        case 7:
          return `Math.${random.pick(["floor", "abs", "sqrt", "sign", "trunc", "round"])}(${sub()})`;
        case 8:
          return `Math.${random.pick(["max", "min", "imul", "hypot"])}(${sub()}, ${sub()})`;
        case 9:
          return `${random.pick(lists)}[${key()}]`;
        case 10:
          return `(${condition()} ? ${sub()} : ${sub()})`;
        case 11:
          return `${random.pick(lists)}.length`;
        default:
          return `(${sub()}) ${random.pick(["/", "%"])} ${random.pick(["2", "3", "0.5", variable()])}`;
      }
    };
    // A store behind the end of a list that a loop walks would keep the loop from ending.
    const storeKey = () =>
      random.pick([
        "0",
        "1",
        "2",
        `${variable()} & 3`,
        `${variable()} & 1`,
        ...counters.map(counter => `${counter} & 3`),
        `${variable()} % 3`,
        `+${variable()} % +${variable()}`,
        "0.5",
        "-1",
      ]);
    const key = () =>
      random.pick([
        small(),
        small(),
        ...counters,
        ...counters,
        variable(),
        `${variable()} & 3`,
        `${variable()} + 1`,
        `${variable()} % ${random.pick(["2", "3", "4", variable(), "0.5", `${random.pick(lists)}.length`])}`,
        `+${variable()} % +${variable()}`,
        `${variable()} >> 1`,
        "0.5",
      ]);
    const condition = (): string =>
      random.pick([
        `${variable()} ${random.pick(["<", ">", "<=", ">=", "===", "!=="])} ${random.chance(0.6) ? variable() : constant().replace("NaN", "0 / 0")}`,
        `(+${variable()}) ${random.pick(["!==", "===", "<"])} (${variable()} ${random.pick([">>", "|", ">>>"])} ${random.pick([variable(), "0"])})`,
        `${random.pick(lists)}[${key()}] ${random.pick(["===", "<", ">"])} ${variable()}`,
        `${variable()} & 1`,
        `(${key()}) in Object(${random.pick(lists)})`,
      ]);
    const assignable = () =>
      random.pick([
        ...locals,
        ...locals,
        ...locals,
        "sum",
        "state.last",
        "state.count",
        ...(random.chance(0.15) ? parameters : []),
      ]);
    const statement = (depth: number): string[] => {
      switch (random.below(depth > 0 ? 11 : 7)) {
        case 0:
        case 1:
          return [`${assignable()} = ${expression(2)};`];
        case 2:
          return [`${assignable()} ${random.pick(["+=", "-=", "+=", "*=", "|=", "^=", "/="])} ${expression(1)};`];
        case 3:
          return [`if (${condition()}) ${assignable()} = ${expression(1)};`];
        case 4:
          return [`${random.pick(lists)}[${storeKey()}] = ${expression(1)};`];
        case 5:
          return [`${assignable()} = ${random.pick(lists)}[${key()}];`];
        case 6:
          return [
            `if (${condition()}) {`,
            ...indent([`${assignable()}${random.pick(["++", "--"])};`]),
            "} else {",
            ...indent([`${assignable()} = ${expression(1)};`]),
            "}",
          ];
        default:
          return loop(depth - 1);
      }
    };
    const loop = (depth: number): string[] => {
      const counter = "i" + nameCount++;
      const end = random.pick(["2", "3", "4", `${random.pick(lists)}.length`, `${random.pick(lists)}.length + 1`, "a"]);
      const guard = end === "a" || end.endsWith("+ 1") ? ` && ${counter} < 6` : "";
      const form = random.below(8);
      const start = random.pick(["0", "0", "1", "0.5", "-1"]);
      const head: [string[], string, string[]] =
        form <= 1
          ? [
              [],
              `for (let ${counter} = ${start}; ${counter} < ${end}${guard}; ${random.pick([counter + "++", counter + "++", "++" + counter, counter + " += 2", counter + " += 0.5"])}) {`,
              [],
            ]
          : form === 2
            ? [
                [],
                `for (let ${counter} = ${random.pick([`${random.pick(lists)}.length - 1`, "3", "4.5", "2.25"])}; ${counter} >= 0; ${random.pick([counter + "--", "--" + counter, counter + " -= 1", counter + " -= 0.5"])}) {`,
                [],
              ]
            : form === 3
              ? [
                  [`let ${counter}${number} = ${random.pick(["2", "3"])};`],
                  "do {",
                  [`} while (${random.pick([`--${counter} >= 0`, `${counter}-- > 0`, `--${counter} > 0`])});`],
                ]
              : form === 4
                ? [
                    [`let ${counter}${number} = ${random.pick(["2", "3"])};`],
                    `while (${random.pick([`${counter}-- > 0`, `${counter}-- >= 0`])}) {`,
                    [],
                  ]
                : form === 5
                  ? [[`let ${counter}${number} = 0;`], `while (${counter} < ${end}${guard}) {`, []]
                  : form === 6
                    ? [
                        [],
                        `for (const ${counter} of ${random.pick(lists.filter(each => each !== "given" || takesList))}) {`,
                        [],
                      ]
                    : [[`let ${counter}${number} = 0;`], "for (;;) {", []];
      const isWalk = form === 6;
      counters.push(counter);
      const body = [
        ...(form === 7 ? [`if (${counter}++ > ${random.pick(["1", "2", "3"])}) break;`] : []),
        ...Array.from({ length: 1 + random.below(3) }, () => statement(depth)).flat(),
        ...(form === 5 ? [`${counter}${random.pick(["++", " += 1", " += 0.5"])};`] : []),
        ...(random.chance(0.12) && form !== 5 ? [`if (${condition()}) ${random.pick(["break", "continue"])};`] : []),
      ];
      counters.pop();
      void isWalk;
      return [...head[0], head[1], ...indent(body), ...(head[2].length ? head[2] : ["}"])];
    };
    // Stores to a counter would keep a loop from ending: nothing above assigns one.
    const declared: string[] = [];
    for (let count = 1 + random.below(3); count > 0; count--) {
      const name = "v" + nameCount++;
      declared.push(
        `let ${name}${random.chance(0.6) ? number : any} = ${random.pick(["0", "0", "1", "0.5", "a", "a | 0", "-1", "a * 2"])};`,
      );
      locals.push(name);
    }
    if (random.chance(0.4)) {
      const name = "own" + nameCount++;
      declared.push(
        `const ${name}${any} = ${random.pick([listOf(), takesList ? "Array.from(given)" : listOf(), "[]"])};`,
      );
      lists.push(name);
    }
    if (random.chance(0.25)) declared.push(`const unused${nameCount++}${list} = [];`);
    const body = [
      ...declared,
      ...loop(2),
      ...(random.chance(0.6) ? loop(1) : []),
      ...(random.chance(0.3) ? statement(0) : []),
    ];
    const guarded = random.chance(0.2)
      ? ["try {", ...indent(body.slice(declared.length)), "} catch (error) {", "  sum -= 1;", "}"]
      : body.slice(declared.length);
    lines.push(
      `function compute${index}(${[...parameters.map(each => each + (random.chance(0.7) ? number : any)), ...(takesList ? ["given" + any] : [])].join(", ")})${any} {`,
      ...indent([
        ...declared,
        ...guarded,
        `return [${locals.join(", ")}${lists
          .filter(each => each.startsWith("own"))
          .map(each => ", " + each)
          .join("")}];`,
      ]),
      "}",
    );
    const argument = () =>
      random.pick([
        "1",
        "2",
        "5",
        "0.5",
        "-0",
        "33",
        "-3",
        "2147483648",
        'JSON.parse("3")',
        'JSON.parse("1.5")',
        "NaN",
      ]);
    for (let call = 1 + random.below(3); call > 0; call--)
      lines.push(
        `console.log(show(compute${index}(${[...parameters.map(argument), ...(takesList ? [random.pick([listOf(), fileLists[0], "[3, 1, 2]"])] : [])].join(", ")})));`,
      );
  }
  lines.push(
    `console.log(show(sum), show(state.count), show(state.last), ${fileLists.map(name => `show(${name})`).join(", ")});`,
  );
  const ownNames = /\b(?:table\d|compute\d|sum|state|show)\b/g;
  return {
    name: `${functionCount}-functions--${fileLists.length}-tables`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "(").replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfNumberLoops = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeNumberLoops(random, isTypeScript, "printValue", "_" + n).lines;
