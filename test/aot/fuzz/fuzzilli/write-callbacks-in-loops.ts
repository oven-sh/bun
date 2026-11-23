// Writes programs in which loops call array methods with callbacks and read elements by any numeric key.
// Callbacks throw, return early, call helpers, change the array under the method, capture variables that the loop changes, and use the index, the array and `this`. Methods nest, and stand in try, switch, generators and async functions.
// Keys are whole, fractional, negative, huge or NaN, and some change their kind in the loop. Arrays have holes or change their element kind.
// Each program prints every result.
// For write-random-callback-sweep.ts and for a scene of write-ordinary-scenes.ts.

const methods = [
  "some",
  "every",
  "map",
  "filter",
  "forEach",
  "find",
  "findIndex",
  "findLast",
  "flatMap",
  "reduce",
] as const;
const sources = ["literal", "json", "from", "pushed", "filled", "sliced", "float64array", "mixed", "holes"] as const;
const places = [
  "top-level",
  "function",
  "method",
  "try",
  "switch",
  "generator",
  "async-function",
  "called-in-loop",
] as const;
const ownNames = /\b(?:helper|list|notes|total|captured|offset|run|Runner|turn0)\b/g;

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeCallbacksInLoops(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const anyType = isTyped ? ": any" : "";
  const source = random.pick(sources);
  const place = random.pick(places);
  const numbers = () =>
    Array.from({ length: 3 + random.below(6) }, () =>
      random.pick(["1", "2", "3", "4", "7", "0", "-1", "0.5", "10"]),
    ).join(", ");
  const list = numbers();
  const created = {
    literal: `[${list}]`,
    json: `JSON.parse("[${list}]")`,
    from: `Array.from([${list}])`,
    pushed: `(() => { const made${isTyped ? ": any[]" : ""} = []; for (const value of [${list}]) made.push(value); return made; })()`,
    filled: `new Array(${3 + random.below(5)}).fill(${random.pick(["0", "1", "0.5"])})`,
    sliced: `[${list}, 5].slice(1)`,
    float64array: `new Float64Array([${list}])`,
    mixed: `[${list}, "text", null]`,
    holes: `[${list}, , 3]`,
  }[source];
  const canGrow = source !== "float64array";
  let depth = 0;
  let nameCount = 0;

  const key = (index: string) =>
    random.pick([index, index, index, `${index} + 1`, `${index} - 1`, `${index} * 2`, `${index} / 2`, `${index} * 0.5 + 0.5`, "-1", "0.5", "NaN", "2 ** 31", "2 ** 32", "offset", `offset + ${index}`, `${index} % 3`, `list.length - 1 - ${index}`]); // prettier-ignore
  // An array with an element at 2 ** 31 takes a minute to walk.
  const storeKey = (index: string) => key(index).replace("2 ** 31", "2 ** 32");
  /** A statement of a callback. */
  const callbackStatement = (value: string, index: string, array: string): string => {
    switch (random.below(canGrow ? 13 : 9)) {
      case 0:
        return `total += helper(${value});`;
      case 1:
        return `if (${index} === ${random.below(4)}) throw new Error("thrown");`;
      case 2:
        return `captured += 1;`;
      case 3:
        return `captured = ${index};`;
      case 4:
        return `total += captured;`;
      case 5:
        return `${array}[${storeKey(index)}] = ${random.pick([`${value}`, "captured", "1.5", ...(canGrow ? ['"x"', "undefined"] : [])])};`;
      case 6:
        return `notes.push(String(${array}[${key(index)}]));`;
      case 7:
        return `if (${index} > ${random.below(4)}) ${random.pick(["offset = 0.5;", "offset++;", "offset = -offset;", "captured = 0;"])}`;
      case 8:
        return nested(array);
      case 9:
        return `if (${array}.length < 24) ${array}.push(captured);`;
      case 10:
        return `if (${index} === 1) ${array}.pop();`;
      case 11:
        return `if (${index} === ${random.below(3)}) ${array}.length = ${1 + random.below(3)};`;
      default:
        return `if (${index} === 0) ${array}.sort();`;
    }
  };
  function nested(array: string): string {
    if (depth >= 2) return "total += 1;";
    return `notes.push(String(${call(array)}));`;
  }
  /** One call of a method, as an expression. */
  function call(array: string): string {
    depth++;
    const suffix = nameCount++;
    const [value, index, inner] = [`value${suffix}`, `index${suffix}`, `array${suffix}`];
    const method = random.pick(methods);
    const statements = Array.from({ length: random.below(3) }, () =>
      callbackStatement(value, index, random.chance(0.6) ? inner : "list"),
    );
    const result = random.pick([
      value,
      `${value} > captured`,
      `${index} % 2 === 0`,
      `helper(${value})`,
      `${inner}[${key(index)}]`,
      "captured",
      `${value} === offset`,
      "undefined",
    ]);
    const earlyReturn = random.chance(0.3)
      ? ` if (${random.pick([`${index} > 2`, `${value} === 3`, "captured > 5"])}) return ${random.pick(["true", "false", "0", "undefined"])};`
      : "";
    const parameter = (name: string) => name + anyType;
    const usesThis = random.chance(0.2) && method !== "reduce";
    const body = `{ ${statements.join(" ")}${earlyReturn} return ${usesThis ? `(${result}) === ${isTyped ? "(this as any)" : "this"}.mark` : result}; }`;
    depth--;
    if (method === "reduce")
      return `${array}.reduce((${parameter("sum" + suffix)}, ${parameter(value)}, ${parameter(index)}, ${parameter(inner)}) => ${body}, ${random.pick(["0", '""', "captured"])})`;
    if (usesThis)
      return `${array}.${method}(function (${isTyped ? "this: any, " : ""}${parameter(value)}, ${parameter(index)}, ${parameter(inner)}) ${body}, { mark: ${random.pick(["1", "true", "0.5"])} })`;
    return `${array}.${method}((${parameter(value)}, ${parameter(index)}, ${parameter(inner)}) => ${body})`;
  }
  const statement = (turn: string): string => {
    switch (random.below(6)) {
      case 0:
        return `total += Number(list[${key(turn)}]);`;
      case 1:
        return `notes.push(String(list[${key(turn)}]));`;
      case 2:
        return canGrow
          ? `list[${storeKey(turn)}] = ${random.pick(["turn0", "0.5", '"y"', "captured"])};`
          : `list[${key(turn)}] = captured;`;
      default:
        return `notes.push(String(${call("list")}));`;
    }
  };

  const statementCount = 1 + random.below(4);
  const loop = [
    `for (let turn0 = 0; turn0 < ${random.pick(["1", "3", "6", "list.length"])} && turn0 < 12; turn0++) {`,
    ...Array.from(
      { length: statementCount },
      () =>
        `  ${place === "generator" && random.chance(0.3) ? "yield total; " : ""}${place === "async-function" && random.chance(0.3) ? "await null; " : ""}${statement("turn0")}`,
    ),
    "}",
  ];
  const indent = (lines: string[]) => lines.map(line => "  " + line);
  const state = [
    `const list${anyType} = ${created};`,
    `const notes${isTyped ? ": any[]" : ""} = [];`,
    `let total${anyType} = 0;`,
    `let captured${anyType} = ${random.pick(["0", "1", "2.5"])};`,
    `let offset${anyType} = ${random.pick(["0", "1", "0.5", "-1"])};`,
  ];
  const helper = `function helper(value${anyType}) {\n  ${random.pick(["return value + 1;", "return value === undefined ? 0 : value;", 'if (value === 7) throw new TypeError("seven");\n  return value * 2;', "return [value].length;"])}\n}`;
  const printResults =
    'console.log(total, captured, offset, notes.join(), Array.from(list, value => String(value)).join("|"));';
  const guarded = ["try {", ...indent(loop), "} catch (error) {", '  console.log("threw", (error).name);'.replace("(error)", isTyped ? "(error as any)" : "error"), "}"]; // prettier-ignore
  const lines = [helper];
  switch (place) {
    case "top-level":
    case "try":
      lines.push(...state, ...guarded, printResults);
      break;
    case "switch":
      lines.push(
        ...state,
        "switch (list.length > 2 ? 1 : 2) {",
        "  case 1: {",
        ...indent(indent(guarded)),
        "    break;",
        "  }",
        "  default:",
        '    console.log("short");',
        "}",
        printResults,
      );
      break;
    case "function":
    case "called-in-loop":
      lines.push(
        "function run() {",
        ...indent(state),
        ...indent(guarded),
        "  " + printResults,
        "}",
        place === "function" ? "run();" : "for (let call = 0; call < 3; call++) run();",
      );
      break;
    case "method":
      lines.push(
        "class Runner {",
        "  run() {",
        ...indent(indent(state)),
        ...indent(indent(guarded)),
        "    " + printResults,
        "  }",
        "}",
        "new Runner().run();",
      );
      break;
    case "generator":
      lines.push(
        `function* run()${isTyped ? ": Generator<any>" : ""} {`,
        ...indent(state),
        ...indent(guarded),
        "  " + printResults,
        "}",
        "console.log([...run()].join());",
      );
      break;
    case "async-function":
      lines.push(
        "async function run() {",
        ...indent(state),
        ...indent(guarded),
        "  " + printResults,
        "}",
        "await run();",
      );
      break;
  }
  return {
    name: `${statementCount}-statements--${source}--${place}`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "(").replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfCallbacksInLoops = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeCallbacksInLoops(random, isTypeScript, "printValue", "_" + n).lines;
