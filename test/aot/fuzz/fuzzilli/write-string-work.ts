// Writes programs of functions that build, search and cut strings. For write-random-string-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Strings are Latin-1 or wider, short or long, grown in loops, cut by slice and substring, compared, switched on, split and joined, kept in locals, fields, lists and variables of the file, and passed to other functions while they grow.
// Characters are read by index and by code, also behind the ends, and numbers become text in several ways.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeStringWork(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const text = isTyped ? ": string" : "";
  const number = isTyped ? ": number" : "";
  const any = isTyped ? ": any" : "";
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const letters = [
    "a",
    "b",
    "ab",
    ",",
    "x",
    " ",
    "é",
    "ü",
    "ÿ",
    "aa",
    "0",
    "7",
    "-",
    "\\n",
    "ß",
    "Ω",
    "日",
    "😀",
    "\\x00",
  ];
  const literal = () => {
    const isLong = random.chance(0.35);
    const parts = Array.from({ length: isLong ? 10 + random.below(24) : random.below(6) }, () =>
      random.pick(random.chance(isLong ? 0.93 : 0.8) ? letters.slice(0, 13) : letters),
    );
    return `"${parts.join("")}"${random.chance(0.15) ? `.repeat(${random.pick(["2", "3", "9", "40"])})` : ""}`;
  };
  const character = () => `"${random.pick(letters)}"`;
  const lines: string[] = [
    `let shared${text} = ${literal()};`,
    `const box${any} = { text: ${literal()}, parts: [${literal()}, ${literal()}], count: 0 };`,
    `const words${any} = [${Array.from({ length: 2 + random.below(4) }, literal).join(", ")}];`,
    `function show(value${any})${any} {`,
    '  if (typeof value === "string") return value.length > 60 ? value.length + ":" + value.slice(0, 20) + ".." + value.slice(-10) : JSON.stringify(value);',
    '  return Array.isArray(value) ? "[" + value.map(show).join() + "]" : Object.is(value, -0) ? "-0" : String(value);',
    "}",
  ];
  const count = 1 + random.below(3);
  let nameCount = 0;
  for (let index = 0; index < count; index++) {
    const strings: string[] = ["s", "s", "shared", "box.text"];
    const numbers: string[] = ["n"];
    const some = () => random.pick([...strings, ...strings, literal(), "words[0]", "words[n % words.length]"]);
    const position = () =>
      random.pick(
        [
          ...numbers,
          ...numbers,
          "0",
          "1",
          "2",
          "-1",
          "15",
          "15",
          "17",
          "20",
          "31",
          "16",
          `${some()}.length`,
          `${some()}.length - 1`,
          "n - 1",
          "1.5",
          "NaN",
          "undefined",
        ].filter(each => !isTyped || each !== "undefined"),
      );
    const textOf = (depth: number): string => {
      if (depth <= 0) return some();
      const sub = () => textOf(depth - 1);
      switch (random.below(16)) {
        case 0:
        case 1:
          return `(${sub()} + ${sub()})`;
        case 2:
          return `${sub()}.slice(${position()}${random.chance(0.6) ? ", " + position() : ""})`;
        case 3:
          return `${sub()}.substring(${position()}, ${position()})`;
        case 4:
          return `${sub()}.charAt(${position()})`;
        case 5:
          return `(${sub()}[${position().replace("undefined", "0")}] ?? "?")`;
        case 6:
          return `${sub()}.replace(${character()}, ${random.pick([character(), '"<$&>"', '""'])})`;
        case 7:
          return `${sub()}.split(${random.pick([character(), '""'])}).join(${character()})`;
        case 8:
          return `${sub()}.${random.pick(["toUpperCase()", "toLowerCase()", "trim()", "trimEnd()", "normalize()", "concat(s, n)"])}`.replace(
            "concat(s, n)",
            isTyped ? "concat(s, String(n))" : "concat(s, n)",
          );
        case 9:
          return `${sub()}.pad${random.pick(["Start", "End"])}(${random.pick(["4", "12", "n"])}, ${character()})`;
        case 10:
          return `String.fromCharCode(${random.pick(["97", "233", "n + 97", "0x3a9", `${sub()}.charCodeAt(0) | 0`])})`;
        case 11:
          return `\`${"${"}${sub()}}-${"${"}${random.pick(numbers)}}\``;
        case 12:
          return random.pick([
            `String(${numberOf(1)})`,
            `(${numberOf(1)}).toString(${random.pick(["", "16", "2"])})`,
            `(${numberOf(0)} + "")`,
            `(${numberOf(0)}).toFixed(2)`,
          ]);
        case 13:
          return `${sub()}.at(${position()})`.replace(/^/, "(") + ' ?? "none")';
        case 14:
          return `(${condition()} ? ${sub()} : ${sub()})`;
        default:
          return `${sub()}.replaceAll(${character()}, ${character()})`;
      }
    };
    const numberOf = (depth: number): string =>
      depth <= 0
        ? random.pick([...numbers, "box.count", "0", "3", "0.5"])
        : random.pick([
            `${some()}.length`,
            `${some()}.indexOf(${random.pick([character(), some()])}${random.chance(0.4) ? ", " + position() : ""})`,
            `${some()}.lastIndexOf(${random.pick([character(), some()])}${random.chance(0.5) ? ", " + position() : ""})`,
            `${some()}.charCodeAt(${position()})`,
            `(${some()}.codePointAt(${position()}) ?? -1)`,
            `${some()}.search(${random.pick(["/a/", "/[b-z]/", "/é/"])})`,
            `${some()}.localeCompare(${some()})`,
            `${some()}.split(${character()}).length`,
            `parseInt(${some()}, 10)`,
            `Number(${some()})`,
            `(${numberOf(0)} + ${numberOf(0)})`,
          ]);
    const condition = (): string =>
      random.pick([
        `${some()} ${random.pick(["===", "!==", "<", ">", "<="])} ${some()}`,
        `${some()}[${random.pick(numbers)}] === ${character()}`,
        `${some()}.charCodeAt(${random.pick(numbers)}) ${random.pick(["===", ">", "<"])} ${random.pick(["97", "98", "48", "44"])}`,
        `${some()}.${random.pick(["startsWith", "endsWith", "includes"])}(${random.pick([character(), some()])})`,
        `${numberOf(1)} ${random.pick([">", "===", "<"])} ${random.pick(["0", "-1", "2", "3"])}`,
        `!${random.pick(strings)}`,
      ]);
    const assignable = () => random.pick([...strings.filter(each => each !== "box.text"), "box.text", "shared"]);
    const statement = (depth: number): string[] => {
      switch (random.below(depth > 0 ? 12 : 8)) {
        case 0:
        case 1:
          return [`${assignable()} = ${textOf(2)};`];
        case 2:
        case 3:
          return [`${assignable()} += ${textOf(1)};`];
        case 4:
          return [`${random.pick([...numbers.filter(each => each.startsWith("k")), "box.count"])} = ${numberOf(1)};`];
        case 5:
          return [`if (${condition()}) ${assignable()} = ${textOf(1)};`];
        case 6:
          return [`box.parts.push(${textOf(1)});`, "if (box.parts.length > 12) box.parts.length = 2;"];
        case 7: {
          const of = random.pick([some(), `${some()}.slice(0, 1)`, `${some()}[0]`, `${some()}.length`]);
          const cases = of.endsWith("length") ? ["0", "1", "3"] : ['"a"', '"ab"', '""', '"b"', '"x"'];
          return [
            `switch (${isTyped ? `(${of} as any)` : of}) {`,
            ...cases
              .slice(0, 2 + random.below(3))
              .flatMap(each => [
                `  case ${each}:`,
                ...(random.chance(0.75)
                  ? [`    box.count += ${random.pick(["1", "10"])};`, ...(random.chance(0.7) ? ["    break;"] : [])]
                  : []),
              ]),
            "  default:",
            "    box.count += 100;",
            "}",
          ];
        }
        default:
          return loop(depth - 1);
      }
    };
    const loop = (depth: number): string[] => {
      const name = "i" + nameCount++;
      const of = random.pick(["s", "shared", "box.text", "words[0]"]);
      const form = random.below(6);
      const head =
        form === 0
          ? [`for (let ${name} = 0; ${name} < ${of}.length && ${name} < 24; ${name}++) {`]
          : form === 1
            ? [`for (let ${name} = Math.min(${of}.length, 24) - 1; ${name} >= 0; ${name}--) {`]
            : form === 2
              ? [`for (let ${name} = 0; ${name} < ${random.pick(["3", "5", "n"])} && ${name} < 8; ${name}++) {`]
              : form === 3
                ? [
                    `for (let ${name} = ${of}.indexOf(${character()}), turns = 0; ${name} >= 0 && turns++ < 9; ${name} = ${of}.indexOf(${character()}, ${name} + 1)) {`,
                  ]
                : form === 4
                  ? [`for (let ${name} = 0; ${name} < words.length; ${name}++) {`]
                  : [`let ${name}${number} = 0;`, `while (${name}++ < ${random.pick(["2", "4", "6"])}) {`];
      numbers.push(name, name);
      const body = Array.from({ length: 1 + random.below(3) }, () => statement(depth)).flat();
      numbers.splice(numbers.length - 2, 2);
      return [
        ...head,
        ...indent([
          ...body,
          ...["shared", "box.text", ...new Set(strings.filter(each => /^[st]\d*$/.test(each)))].map(
            each =>
              `if (${each}.length > ${depth > 0 ? 300 : 900}) ${each} = ${each}.slice(${random.pick(["0, 30", "-40"])});`,
          ),
        ]),
        "}",
      ];
    };
    const declared: string[] = [];
    for (let local = 1 + random.below(2); local > 0; local--) {
      const name = "t" + nameCount++;
      declared.push(`let ${name}${text} = ${random.pick(['""', '""', "s", literal(), "shared"])};`);
      strings.push(name, name);
    }
    const counter = "k" + nameCount++;
    declared.push(`let ${counter}${number} = ${random.pick(["0", "n", "s.length"])};`);
    numbers.push(counter);
    const main = [...loop(2), ...(random.chance(0.6) ? loop(1) : []), ...statement(0)];
    const cut = strings.filter(each => /^t\d/.test(each)).filter((each, at, all) => all.indexOf(each) === at);
    lines.push(
      `function work${index}(s${random.chance(0.7) ? text : any}, n${number})${any} {`,
      ...indent([
        ...declared,
        ...main,
        ...cut.map(each => `if (${each}.length > 900) ${each} = ${each}.slice(0, 99);`),
        `return [${[...cut, counter, ...(index > 0 && random.chance(0.4) ? [`work${index - 1}(${cut[0]}.slice(0, 200), 2)`] : [])].join(", ")}];`,
      ]),
      "}",
    );
  }
  const argument = () =>
    random.pick([
      literal(),
      literal(),
      '"abcabc"',
      '"a,b,c,d,e,f"',
      'JSON.parse("\\"xyz\\"")',
      '"日本"',
      '""',
      '"a".repeat(30)',
    ]);
  for (let index = 0; index < count; index++)
    for (let call = 1 + random.below(2); call > 0; call--)
      lines.push(
        "try {",
        `  console.log(show(work${index}(${argument()}, ${random.pick(["0", "1", "3", "7", "20"])})));`,
        "} catch (error) {",
        `  console.log("threw", (error${isTyped ? " as any" : ""}).name);`,
        "}",
      );
  lines.push("console.log(show(shared), show(box.text), show(box.parts), box.count);");
  const ownNames = /\b(?:work\d|shared|box|words|show)\b/g;
  return {
    name: `${count}-functions`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "(").replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfStringWork = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeStringWork(random, isTypeScript, "printValue", "_" + n).lines;
