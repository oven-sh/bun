// Writes programs whose functions hold many values at once: ten to fifty variables of several kinds that live across calls, allocations, loops, tries and closures, and helpers of up to fourteen parameters.
// For write-random-wide-sweep.ts and for a scene of write-ordinary-scenes.ts. Each program prints every variable.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeWideFunctions(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  type Kind = "int" | "double" | "text" | "truth" | "object" | "list";
  const kinds: Kind[] = ["int", "int", "int", "double", "double", "text", "truth", "object", "list"];
  const types: Record<Kind, string> = { int: "number", double: "number", text: "string", truth: "boolean", object: "Point" + suffix, list: "number[]" }; // prettier-ignore
  const isAny = isTyped && random.chance(0.3);
  const typeOf = (kind: Kind) => (isTyped ? ": " + (isAny ? "any" : types[kind]) : "");
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const literal: Record<Kind, () => string> = {
    int: () => random.pick(["0", "1", "2", "3", "7", "-1", "-5", "100", "255", "65536", "2147483647", "-2147483648"]),
    double: () => random.pick(["0.5", "1.25", "-2.5", "0.1", "1e9", "-0.5", "3.75", "1e-3"]),
    text: () => random.pick(['"a"', '"bc"', '""', '"text"', '"0"']),
    truth: () => random.pick(["true", "false"]),
    object: () => `{ x: ${random.below(9)}, y: ${random.below(9)}.5 }`,
    list: () => `[${Array.from({ length: random.below(4) }, () => random.below(20)).join(", ")}]`,
  };
  type Helper = { name: string; parameters: Kind[]; result: Kind };
  const helpers: Helper[] = [];
  type Variable = { name: string; kind: Kind };
  const expression = (kind: Kind, variables: Variable[], depth = 0): string => {
    const of = (wanted: Kind) => {
      const known = variables.filter(each => each.kind === wanted);
      return known.length && random.chance(0.85) ? random.pick(known).name : literal[wanted]();
    };
    if (depth > 2 || random.chance(0.15)) return of(kind);
    const deeper = (wanted: Kind) => (random.chance(0.4) ? expression(wanted, variables, depth + 1) : of(wanted));
    const fitting = helpers.filter(each => each.result === kind);
    if (fitting.length && random.chance(0.2)) {
      const helper = random.pick(fitting);
      return `${helper.name}(${helper.parameters.map(each => (random.chance(0.15) ? expression(each, variables, depth + 2) : of(each))).join(", ")})`; // prettier-ignore
    }
    const number = () => deeper(random.pick(["int", "int", "double"]));
    const makers: Record<Kind, (() => string)[]> = {
      int: [
        () => `((${number()} + ${number()}) | 0)`,
        () => `((${number()} - ${number()}) | 0)`,
        () => `Math.imul(${number()}, ${number()})`,
        () => `(${deeper("int")} ${random.pick(["&", "|", "^"])} ${deeper("int")})`,
        () => `(${deeper("int")} ${random.pick(["<<", ">>"])} ${random.below(6)})`,
        () => `${of("list")}.length`,
        () => `${of("text")}.length`,
        () => `(${of("object")}.x | 0)`,
        () => `((${of("list")}[${random.below(3)}] ?? ${random.below(5)}) | 0)`,
        () => `(${deeper("truth")} ? ${deeper("int")} : ${deeper("int")})`,
        () => `(${deeper("double")} | 0)`,
      ],
      double: [
        () => `(${number()} + ${number()})`,
        () => `(${number()} - ${number()})`,
        () => `(${number()} * ${random.pick(["0.5", "1.5", "-1", "0.25"])})`,
        () => `(${number()} / ${random.pick(["2", "3", "7", "-4"])})`,
        () => `${of("object")}.y`,
        () => `Math.sqrt(Math.abs(${number()}))`,
        () => `(${deeper("truth")} ? ${deeper("double")} : ${deeper("int")})`,
        () => `-${of("double")}`.replace("--", "- -"),
      ],
      text: [
        () => `(${of("text")} + ${of("text")}).slice(-12)`,
        () => `("" + ${deeper("int")}).slice(0, 8)`,
        () => `String(${of("double")}).slice(0, 8)`,
        () => `${of("text")}.slice(${random.below(2)}, ${2 + random.below(5)})`,
        () => `(${deeper("truth")} ? ${of("text")} : ${of("text")})`,
        () => `\`\${${of("int")}}\${${of("text")}}\`.slice(-9)`,
      ],
      truth: [
        () => `(${number()} ${random.pick(["<", "<=", ">", ">="])} ${number()})`,
        () => `(${deeper("int")} === ${deeper("int")})`,
        () => `(${of("text")} < ${of("text")})`,
        () => `!${of("truth")}`,
        () => `(${of("truth")} ${random.pick(["&&", "||"])} ${deeper("truth")})`,
        () => `(show${suffix}(${of("object")}) === show${suffix}(${of("object")}))`,
      ],
      object: [
        () => `{ x: ${deeper("int")}, y: ${deeper("double")} }`,
        () => `{ ...${of("object")}, x: ${deeper("int")} }`,
        () => `(${deeper("truth")} ? ${of("object")} : ${of("object")})`,
        () => `new Pair${suffix}(${deeper("int")}, ${deeper("double")})`,
      ],
      list: [
        () => `[${deeper("int")}, ${deeper("int")}]`,
        () => `${of("list")}.slice(0, ${1 + random.below(4)})`,
        () => `[...${of("list")}, ${deeper("int")}].slice(-5)`,
        () => `${of("list")}.map(${isTyped ? "(each: any)" : "each"} => (each + ${of("int")}) | 0)`,
        () => `(${deeper("truth")} ? ${of("list")} : ${of("list")})`,
      ],
    };
    const made = random.pick(makers[kind])();
    return kind === "object" && made.startsWith("{") ? `(${made})` : made;
  };
  let names = 0;
  const statements = (variables: Variable[], depth: number, most: number, inLoop = false): string[] => {
    const made: string[] = [];
    for (let times = 1 + random.below(most); times > 0; times--) {
      const roll = depth > 2 ? 0 : random.below(20);
      const target = random.pick(variables);
      if (roll === 13)
        made.push(`if (${expression("truth", variables)}) {`, ...indent(statements(variables, depth + 1, 4, inLoop)), ...(random.chance(0.5) ? ["} else {", ...indent(statements(variables, depth + 1, 4, inLoop))] : []), "}"); // prettier-ignore
      else if (roll === 14 || roll === 15) {
        const at = "i" + names++;
        made.push(`for (let ${at} = 0; ${at} < ${random.pick(["2", "3", "4", "5"])}; ${at}++) {`, ...indent(statements([...variables, { name: at, kind: "int" }].filter(each => each.name !== at || random.chance(0.9)), depth + 1, 5, true).map(line => line.replace(new RegExp(`^(\\s*)${at} = `), "$1spare = "))), ...(random.chance(0.3) ? [`  if (${expression("truth", variables)}) ${random.pick(["break;", "continue;"])}`] : []), "}"); // prettier-ignore
      } else if (roll === 16)
        made.push("try {", ...indent(statements(variables, depth + 1, 4, inLoop)), `  if (${expression("truth", variables)}) throw ${expression(random.pick(["int", "text", "object"]), variables)};`, ...indent(statements(variables, depth + 1, 2, inLoop)), "} catch {", ...indent(statements(variables, depth + 1, 3, inLoop)), "}"); // prettier-ignore
      else if (roll === 17) {
        const f = "f" + names++;
        made.push(`const ${f} = (${isTyped ? "q: number" : "q"}) => ${expression("int", [...variables, { name: "q", kind: "int" }])};`, `spare = ${f}(${expression("int", variables)});`); // prettier-ignore
      } else if (roll === 18 && target.kind === "object")
        made.push(`${target.name}.${random.pick(["x", "y"])} = ${expression("int", variables)};`); // prettier-ignore
      else if (roll === 19 && target.kind === "list")
        made.push(random.pick([`${target.name}[${random.below(3)}] = ${expression("int", variables)};`, `if (${target.name}.length < 9) ${target.name}.push(${expression("int", variables)});`, `${target.name}.sort((a${isTyped ? ": any" : ""}, b${isTyped ? ": any" : ""}) => a - b);`])); // prettier-ignore
      else made.push(`${target.name} = ${expression(target.kind, variables)};`);
    }
    return made;
  };
  const lines: string[] = [
    ...(isTyped ? [`interface Point${suffix} {\n  x: number;\n  y: number;\n}`] : []),
    `class Pair${suffix} {`,
    ...(isTyped ? ["  x: number;", "  y: number;"] : []),
    `  constructor(x${isTyped ? ": number" : ""}, y${isTyped ? ": number" : ""}) {`,
    "    this.x = x;",
    "    this.y = y;",
    "  }",
    "}",
    `const show${suffix} = (value${isTyped ? ": any" : ""})${isTyped ? ": string" : ""} => (Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "{" + Object.values(value).map(show${suffix}).join(";") + "}" : String(value));`,
  ];
  const functions = 2 + random.below(3);
  for (let f = 0; f < functions; f++) {
    const parameters = Array.from({ length: random.pick([1, 3, 6, 8, 11, 14]) }, () => random.pick(kinds));
    const result = random.pick(kinds);
    const name = `wide${f}${suffix}`;
    const variables: Variable[] = parameters.map((kind, at) => ({ name: "p" + at, kind }));
    const locals: string[] = [];
    for (let count = random.pick([4, 8, 14, 22, 34]), at = 0; at < count; at++) {
      const kind = random.pick(kinds);
      locals.push(`let v${at}${typeOf(kind)} = ${expression(kind, variables)};`);
      variables.push({ name: "v" + at, kind });
    }
    const body = [
      `let spare${isTyped ? ": number" : ""} = 0;`,
      ...locals,
      ...statements(variables, 0, 10),
      ...(random.chance(0.5)
        ? [`log${suffix}.push([${variables.map(each => each.name).join(", ")}].map(show${suffix}).join());`]
        : []),
      `log${suffix}.push(show${suffix}(spare));`,
      `return ${expression(result, variables)};`,
    ];
    lines.push(`function ${name}(${parameters.map((kind, at) => `p${at}${typeOf(kind)}`).join(", ")})${typeOf(result)} {`, ...indent(body), "}"); // prettier-ignore
    helpers.push({ name, parameters, result });
  }
  lines.splice(lines.findIndex(line => line.startsWith("const show")) + 1, 0, `const log${suffix}${isTyped ? ": string[]" : ""} = [];`); // prettier-ignore
  for (const helper of helpers)
    for (let times = 0; times < 3; times++)
      lines.push(
        "try {",
        `  ${print}(show${suffix}(${helper.name}(${helper.parameters.map(kind => (random.chance(0.4) && kind !== "object" ? `JSON.parse('${literal[kind]()}')` : literal[kind]())).join(", ")})));`,
        `} catch (error) {\n  ${print}("threw", ${isTyped ? "(error as any)" : "error"}?.name);\n}`,
      ); // prettier-ignore
  lines.push(`${print}(log${suffix}.slice(-20).join("\\n").slice(-3000));`);
  return { name: `${functions}-functions`, lines };
}

/** The lines of a scene whose program prints by `printValue`. */
export const writeSceneOfWideFunctions = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeWideFunctions(random, isTypeScript, "printValue", "_" + n).lines;
