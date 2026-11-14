// Writes programs of functions that call each other in many forms. For write-random-call-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Parameters have defaults that read other parameters, patterns and rest; callees are named directly, kept in lists, fields and variables that change during the call, bound, applied, called through accessors or optional chains, with spread lists and with too few or too many arguments.
// Functions throw through frames with finally, recurse, hand out closures over parameters that change later and look at `this`, `arguments` and new.target.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeCallChains(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const any = isTyped ? ": any" : "";
  const list = isTyped ? ": any[]" : "";
  const asAny = (text: string) => (isTyped ? `(${text} as any)` : text);
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const count = 3 + random.below(4);
  let nameCount = 0;
  const constant = () =>
    random.pick(["0", "1", "2", "0.5", '"s"', "undefined", "null", "[1, 2]", "{ x: 3 }", "true", "-1", "() => 5"]);
  const lines: string[] = [
    "let steps = 0;",
    `const kept${list} = [];`,
    `const box${any} = { value: 1, run: null, get made() { return kept[steps % (kept.length || 1)] ?? null; } };`,
    `function text(value${any})${any} {`,
    '  if (typeof value === "function") return "f" + value.length;',
    '  if (Array.isArray(value)) return "[" + value.map(text).join() + "]";',
    '  if (value && typeof value === "object") return "{" + Object.keys(value).map(key => key + ":" + text(value[key])).join() + "}";',
    "  return String(value);",
    "}",
  ];
  type Kind = { name: string; parameters: string[]; isArrow: boolean; hasThis: boolean };
  const functions: Kind[] = [];
  const argumentList = (values: string[]): string => {
    const given = Array.from({ length: random.below(5) }, () => random.pick([...values, ...values, constant()]));
    if (random.chance(0.2))
      given.push(`...${random.pick(["[1, 2]", "[]", "kept.slice(0, 1)", '"ab"', "new Set([4, 5])", "[undefined]"])}`);
    if (random.chance(0.07)) given.unshift(`...[${constant()}]`);
    return given.join(", ");
  };
  const callee = (index: number) => "call" + index;
  const callOf = (index: number, values: string[]): string => {
    const name = asAny(callee(index));
    const given = argumentList(values);
    switch (random.below(13)) {
      case 0:
        return `${name}.call(${random.pick(["box", "null", "7", "undefined"])}${given ? ", " + given : ""})`;
      case 1:
        return `${name}.apply(${random.pick(["box", "null"])}, [${given}])`;
      case 2:
        return `${name}.bind(${random.pick(["box", "null"])}${random.chance(0.5) ? ", " + constant() : ""})(${given})`;
      case 3:
        return `Reflect.apply(${name}, ${random.pick(["box", "undefined"])}, [${given}])`;
      case 4:
        return `(box.run = ${name}, box.run(${given}))`;
      case 5:
        return `[${name}, ${name}][${random.pick(["steps & 1", "steps % 2"])}](${given})`;
      case 6:
        return `${name}?.(${given})`;
      case 7:
        return `((...rest${list}) => ${name}(...rest))(${given})`;
      default:
        return `${name}(${given})`;
    }
  };
  for (let index = 0; index < count; index++) {
    const name = callee(index);
    const parameters: string[] = [];
    const names: string[] = [];
    for (let at = random.below(4); at > 0; at--) {
      const parameter = "p" + nameCount++;
      switch (random.below(7)) {
        case 0:
          parameters.push(
            `${parameter}${any} = ${random.pick([constant(), names[0] ?? "1", "steps", `text(${names[0] ?? "2"})`])}`,
          );
          names.push(parameter);
          break;
        case 1:
          parameters.push(`{ x: ${parameter} = ${random.pick(["1", '"d"', "steps"])} }${any} = {}`);
          names.push(parameter);
          break;
        case 2:
          parameters.push(`[${parameter}, other${nameCount} = 2]${any} = [3]`);
          names.push(parameter, "other" + nameCount++);
          break;
        default:
          parameters.push(isTyped ? `${parameter}?: any` : parameter);
          names.push(parameter);
      }
    }
    // An optional parameter stands behind no other in TypeScript: the rest has defaults or is optional as well.
    if (random.chance(0.2)) {
      const parameter = "rest" + nameCount++;
      parameters.push(`...${parameter}${list}`);
      names.push(parameter);
    }
    const isArrow = random.chance(0.25);
    const isMethod = !isArrow && random.chance(0.2);
    const hasArguments = !isArrow && random.chance(0.3);
    const values = [...names, "steps"];
    const body: string[] = ["steps++;", `if (steps > ${20 + random.below(60)}) return "deep";`];
    if (hasArguments)
      body.push(
        random.pick([
          "const seen" + index + any + " = arguments.length;",
          `const seen${index}${any} = text(Array.from(arguments));`,
          `const seen${index}${any} = [...arguments].length;`,
          `const seen${index}${any} = arguments[1];`,
        ]),
      );
    for (let part = 1 + random.below(3); part > 0; part--)
      switch (random.below(9)) {
        case 0:
          if (names.length && !names[0].startsWith("rest"))
            body.push(`${names[0]} = ${random.pick(["steps", '"changed"', constant()])};`);
          break;
        case 1:
          body.push(
            `kept.push(${random.pick([`() => ${values[0]}`, `() => text(${values[0]})`, name, ...(index ? [callee(random.below(index))] : [])])});`,
          );
          break;
        case 2:
          body.push(
            `if (${random.pick([`steps === ${3 + random.below(9)}`, `${asAny(values[0])} === ${random.below(3)}`])}) throw new Error("${name}");`,
          );
          break;
        case 3:
          if (index)
            body.push(
              "try {",
              ...indent([`box.value = ${callOf(random.below(index), values)};`]),
              "} catch (error) {",
              `  box.value = "caught " + ${asAny("error")}.message;`,
              ...(random.chance(0.5)
                ? ["} finally {", "  steps += 0;", ...indent(random.chance(0.3) ? [`kept.push(${values[0]});`] : [])]
                : []),
              "}",
            );
          break;
        case 4:
          body.push(
            `if (kept.length && typeof kept[0] === "function" && steps % 3 === 0) box.value = kept[0](${random.pick(["", values[0]])});`,
          );
          break;
        case 5:
          body.push(
            `for (let i = 0; i < ${random.pick(["2", "3"])}; i++) ${index ? `box.value = ${callOf(random.below(index), [...values, "i"])};` : "steps += 0;"}`,
          );
          break;
        case 6:
          if (!isArrow && !isTyped)
            body.push(
              `const self${nameCount++} = ${random.pick(["typeof this", "this?.value", "this === box", "new.target === undefined"])};`,
              `box.last = self${nameCount - 1};`,
            );
          break;
        default:
          if (index)
            body.push(
              `const got${nameCount++}${any} = ${callOf(random.below(index), values)};`,
              `box.value = got${nameCount - 1};`,
            );
      }
    body.push(
      `return ${random.pick([
        values[0],
        `[${values.join(", ")}]`,
        ...(index ? [callOf(random.below(index), values), callOf(random.below(index), values)] : ["steps"]),
        hasArguments ? `[seen${index}, ${values[0]}]` : "box.value",
        `() => ${values[0]}`,
      ])};`,
    );
    const parameterText = parameters.join(", ");
    lines.push(
      ...(isArrow
        ? [`let ${name}${any} = (${parameterText})${any} => {`, ...indent(body), "};"]
        : isMethod
          ? [
              `const holder${index}${any} = {`,
              `  ${name}(${parameterText})${any} {`,
              ...indent(indent(body)),
              "  },",
              "};",
              `let ${name}${any} = holder${index}.${name};`,
            ]
          : [`function ${name}(${parameterText})${any} {`, ...indent(body), "}"]),
    );
    functions.push({ name, parameters, isArrow, hasThis: !isArrow });
  }
  const rounds = random.pick(["1", "2", "3", "4"]);
  lines.push(`for (let round = 0; round < ${rounds}; round++) {`);
  for (let call = 2 + random.below(4); call > 0; call--) {
    const index = random.pick([count - 1, count - 1, random.below(count)]);
    lines.push(
      "  try {",
      `    console.log(round, text(${callOf(index, ["round", "box.value"])}), steps);`,
      "  } catch (error) {",
      `    console.log(round, "threw", ${asAny("error")}.message, steps);`,
      "  }",
    );
    if (random.chance(0.3)) lines.push("  steps = 0;");
  }
  const arrows = functions.filter(each => each.isArrow);
  if (arrows.length && random.chance(0.3))
    lines.push(
      `  if (round === 1) ${arrows[0].name} = ${random.pick(["() => 9", `(value${any}) => text(value)`, functions[0].name])};`,
    );
  lines.push("}", "console.log(text(kept.slice(0, 6)), text(box.value), text(box.last), steps);");
  const ownNames = /\b(?:call\d(?!\.prototype)|holder\d|steps|kept|box|text)\b/g;
  return {
    name: `${count}-functions--${rounds}-rounds`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "(").replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfCallChains = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeCallChains(random, isTypeScript, "printValue", "_" + n).lines;
