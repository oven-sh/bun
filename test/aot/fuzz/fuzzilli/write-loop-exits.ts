// Writes programs of nested loops that end early. For write-random-exit-sweep.ts and for a scene of write-ordinary-scenes.ts.
// A test of an element, of a counter or of what was found so far leaves a loop by break, continue, a label, return, throw or a changed counter, also out of switch, try and finally. Elements are numbers, fractions, strings, objects, undefined or holes, or the list is a view, a string or an object with a length.
// Loops are for, while, do and for-of, up and down, and read under their own counter, under that of the loop around them and under computed keys.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeLoopExits(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const number = isTyped ? ": number" : "";
  const some = (from: string[], most: number) => Array.from({ length: 1 + random.below(most) }, () => random.pick(from)).join(", "); // prettier-ignore
  const listOf = () =>
    random.pick([
      () =>
        `Array.from({ length: ${4 + random.below(20)} }, (_, at) => ${random.pick(["at % 5", "at", "at / 2", "7 - at", "at & 1 ? undefined : at"])})`,
      () => `[${some(["1", "2", "3", "0", "5", "9"], 10)}]`,
      () => `[${some(["1", "0.5", "-0", "NaN", "2"], 8)}]`,
      () => `[${some(["1", "undefined", "3", "null", "0"], 8)}]`,
      () => `[${some(["1", "2"], 3)}, , 4, , 2]`,
      () => `[${some(['"a"', '"b"', '""', '"text"', "undefined"], 7)}]`,
      () => `[${some(["{ size: 1 }", '{ size: 2, name: "n" }', "null", '{ name: "m" }', "{ size: undefined }"], 6)}]`,
      () => `[${some(["1", '"1"', "true", "{ size: 3 }", "undefined", "[2]"], 7)}]`,
      () => `new Array(${2 + random.below(6)}).fill(${random.pick(["0", "1", "undefined", "null"])})`,
      () => `new Uint8Array([${some(["1", "0", "200", "3"], 8)}])`,
      () => `new Float64Array([${some(["0.5", "0", "NaN", "3"], 6)}])`,
      () => `JSON.parse("[${some(["1", "2", "null", "0.5"], 7)}]")`,
      () => `"${random.pick(["text", "a,b,c", "abcabc", "0120"])}"`,
      () => "{ length: 3, 0: 1, 2: 2 }",
      () => "[]",
      () => `[[${some(["1", "2"], 3)}], [${some(["0", "3"], 3)}], []]`,
    ])();
  const functionCount = 1 + random.below(3);
  let nameCount = 0;
  const lines: string[] = [
    `let seen${any} = 0;`,
    `const keep${any} = [];`,
    `function show(value${any})${any} {`,
    '  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "[" + (Array.isArray(value) ? value : Object.entries(value)).map(show).join() + "]" : String(value);', // prettier-ignore
    "}",
    `function isWanted(value${any}, at${any})${any} {`,
    `  ${random.pick(["return value === 2;", "return value !== undefined && at > 1;", "seen++;\n  return value > 1;", 'return typeof value === "number" && value % 2 === 1;'])}`,
    "}",
  ];
  const calls: string[] = [];
  type Loop = { counter: string; isUp: boolean; label: string; step: string; isWhile: boolean; isCounted: boolean };
  for (let index = 0; index < functionCount; index++) {
    const form = random.pick(["function", "function", "function", "arrow", "generator", "async", "method"]);
    const labels = new Set<string>();
    const taken = new Set<string>();
    const loops: Loop[] = [];
    const inSwitch: boolean[] = [];
    const counter = () => (loops.length ? random.pick([loops.at(-1)!, ...loops]).counter : "count");
    const key = () =>
      random.pick([
        counter(),
        counter(),
        counter(),
        counter(),
        `${counter()} + 1`,
        `${counter()} - 1`,
        `count - 1 - ${counter()}`,
        `(${counter()} * 3) % (c.length || 1)`,
        "0",
        "count",
        `${counter()} ^ 1`,
        "c.length - 1",
      ]);
    const element = () => `c[${key()}]`;
    const test = (): string =>
      random.pick([
        () => `${element()} !== undefined`,
        () => `${element()} === undefined`,
        () => `${element()} !== undefined`,
        () => `${element()} == null`,
        () => `${element()} != null`,
        () => `${element()} > ${random.pick(["1", "2", "0", "total"])}`,
        () => `${element()} < ${random.pick(["2", "3", counter()])}`,
        () => `${element()} === ${random.pick(["1", "2", '"a"', "0", "null", element()])}`,
        () => `!${element()}`,
        () => element(),
        () => `typeof ${element()} === "${random.pick(["number", "string", "object", "undefined"])}"`,
        () => `${element()}?.size ${random.pick(["=== 1", "> 1", "!== undefined"])}`,
        () => `isWanted(${element()}, ${counter()})`,
        () => `${counter()} > ${random.pick(["1", "3", "count - 2"])}`,
        () => `${counter()} === ${random.pick(["2", "count - 1", "c.length - 1"])}`,
        () => `total > ${random.pick(["5", "12", "30"])}`,
        () => `found ${random.pick(["!== undefined", "=== undefined", "> 1"])}`,
        () => `(${counter()} & 1) === ${random.pick(["0", "1"])}`,
        () => `${test()} ${random.pick(["&&", "||"])} ${test()}`,
        () => `!(${test()})`,
      ])();
    const advance = (loop: Loop) => (loop.isWhile ? `${loop.step};\n` : "");
    const exit = (): string => {
      const inner = loops.at(-1)!;
      const outer = random.pick(loops);
      const label = () => {
        labels.add(outer.counter);
        return outer.label;
      };
      return random.pick([
        () => (inSwitch.at(-1) ? `${advance(inner)}continue;` : "break;"),
        () => (inSwitch.at(-1) ? `${advance(inner)}continue;` : "break;"),
        () => "break;",
        () => `${advance(inner)}continue;`,
        () => `break ${label()};`,
        () => `${advance(outer)}continue ${label()};`,
        () => (form === "generator" ? "return;" : `return ${random.pick(["total", "found", `[total, ${counter()}]`, element()])};`), // prettier-ignore
        () => (inner.isCounted ? (inner.isUp ? `${inner.counter} += ${random.pick(["1", "2"])};` : `${inner.counter} -= ${random.pick(["1", "2"])};`) : "break;"), // prettier-ignore
        () => 'throw new Error("stop " + total);',
      ])();
    };
    const work = (): string =>
      random.pick([
        () => "total += 1;",
        () => "total += 1;",
        () => `total += ${random.pick(["2", "0.5", counter(), `${counter()} * 2`])};`,
        () => `found = ${element()};`,
        () => `found ??= ${element()};`,
        () => `if (${test()}) total += 3;`,
        () => `text += ${random.pick(['"."', counter(), `typeof ${element()}`])};`,
        () => `out.push(${random.pick([counter(), element(), "total"])});`,
        () => `seen += 1;`,
        () => `const kept${nameCount} = ${element()};\nif (kept${nameCount++} !== undefined) total += 1;`,
        () => `if (${test()}) out.push(() => ${counter()});`,
        ...(form === "generator" ? [() => `yield ${random.pick(["total", counter(), element()])};`] : []),
        ...(form === "async" ? [() => "await null;", () => `total += (await ${counter()});`] : []),
      ])();
    const statement = (depth: number): string[] => {
      switch (random.below(depth > 0 ? 12 : 8)) {
        case 0:
        case 1:
          return [work()];
        case 2:
        case 3:
        case 4: {
          const leaving = exit();
          return /\n/.test(leaving) || random.chance(0.3)
            ? [`if (${test()}) {`, ...indent([...(random.chance(0.4) ? [work()] : []), leaving]), "}"]
            : [`if (${test()}) ${leaving}`];
        }
        case 5:
          return [
            "try {",
            ...indent([work(), `if (${test()}) {`, ...indent([exit()]), "}"]),
            ...random.pick([
              ["} finally {", ...indent([random.pick(["total += 1;", "seen++;", 'text += "f";'])]), "}"],
              ["} catch {", "  total += 5;", "}"],
              [
                "} catch (error) {",
                `  text += (error${isTyped ? " as any" : ""}).message;`,
                "} finally {",
                "  total += 1;",
                "}",
              ],
            ]),
          ];
        case 6: {
          inSwitch.push(true);
          const cases = [random.pick(["0", "1"]), random.pick(["2", '"a"', "undefined"])].flatMap(value => [
            `case ${value}:`,
            ...indent([work(), ...(random.chance(0.7) ? [random.pick([() => "break;", exit])()] : [])]),
          ]);
          const last = random.chance(0.5) ? ["default:", ...indent([random.pick([work, exit])()])] : [];
          inSwitch.pop();
          return [`switch (${random.pick([element(), counter(), `${counter()} % 3`])}${isTyped ? " as any" : ""}) {`, ...indent([...cases, ...last]), "}"]; // prettier-ignore
        }
        case 7:
          return [`if (${test()}) {`, ...indent([work()]), "} else {", ...indent([work()]), "}"];
        default:
          return loop(depth - 1);
      }
    };
    const body = (depth: number) => Array.from({ length: 1 + random.below(3) }, () => statement(depth)).flat();
    const loop = (depth: number): string[] => {
      const letter = "ijkmn"[loops.length] ?? "q";
      const name = taken.has(letter) ? letter + nameCount++ : letter;
      taken.add(name);
      const label = "at_" + name;
      const end = random.pick(["count", "count", "c.length", "c.length", "3"]);
      const outer = loops.at(-1);
      const kind = random.below(9);
      const made: Loop = { counter: name, label, isUp: true, step: name + "++", isWhile: false, isCounted: true };
      let head: string[];
      let tail = ["}"];
      let before: string[] = [];
      if (kind <= 2)
        head = [`for (let ${name} = ${random.pick(["0", "0", "1", ...(outer?.isCounted && outer.isUp ? [outer.counter, outer.counter + " + 1"] : [])])}; ${name} < ${end}; ${random.pick([name + "++", name + " += 1", name + " += 2"])}) {`]; // prettier-ignore
      else if (kind <= 4) {
        made.isUp = false;
        made.step = name + "--";
        head = [`for (let ${name} = ${random.pick([`${end} - 1`, end])}; ${name} ${outer?.isCounted && outer.isUp && random.chance(0.4) ? ">= " + outer.counter : random.pick([">= 0", "> 0"])}; ${name}--) {`]; // prettier-ignore
      } else if (kind === 5) {
        made.isWhile = true;
        before = [`let ${name}${number} = 0;`];
        head = [`while (${name} < ${end}) {`];
      } else if (kind === 6) {
        made.isUp = false;
        before = [`let ${name}${number} = ${end};`];
        head = [`while (${random.pick([`--${name} >= 0`, `${name}-- > 0`])}) {`];
      } else if (kind === 7) {
        before = [`let ${name}${number} = 0;`];
        head = ["do {"];
        tail = [`} while (++${name} < ${end});`];
      } else {
        made.isCounted = false;
        head = [`for (const ${name} of ${random.pick(["[0, 1, 2]", "[2, 0, 1, 3]", "Array(count).keys()"])}) {`];
      }
      loops.push(made);
      inSwitch.push(false);
      const inside = body(depth);
      inSwitch.pop();
      loops.pop();
      const isLabeled = labels.has(name);
      labels.delete(name);
      return [
        ...before,
        ...(isLabeled ? [label + ":"] : []),
        ...head,
        ...indent([`if (++fuel > 400) ${form === "generator" ? "return;" : 'return "fuel";'}`]).filter(() => hasFuel),
        ...indent(inside),
        ...(made.isWhile ? indent([made.step + ";"]) : []),
        ...tail,
      ];
    };
    const hasFuel = random.chance(0.3);
    const depth = random.pick([1, 1, 2, 2, 2]);
    const main = [...loop(depth), ...(random.chance(0.25) ? loop(0) : [])];
    const uses = (word: string) => main.some(line => new RegExp(`\\b${word}\\b`).test(line));
    const result = random.pick(["total", "[total, found, text, out.length]", "[total, text]", "found", "[total, out.map(one => (typeof one === \"function\" ? one() : one))]"]); // prettier-ignore
    const isUsed = (word: string) => uses(word) || new RegExp(`\\b${word}\\b`).test(result);
    const text = [
      `let total${any} = 0;`,
      ...(isUsed("found") ? [`let found${any};`] : []),
      ...(isUsed("text") ? [`let text${isTyped ? ": string" : ""} = "";`] : []),
      ...(isUsed("out") ? [`const out${isTyped ? ": any[]" : ""} = [];`] : []),
      ...(hasFuel ? ["let fuel = 0;"] : []),
      ...main,
    ];
    const listType = isTyped ? random.pick([": any", ": any", ": any[]"]) : "";
    const head = `(c${listType}, count${number})`;
    const closing = form === "generator" ? `yield ${result};` : `return ${result};`;
    if (form === "generator")
      lines.push(`function* find${index}${head}${isTyped ? ": Generator<any>" : ""} {`, ...indent([...text, closing]), "}"); // prettier-ignore
    else if (form === "async")
      lines.push(`async function find${index}${head}${isTyped ? ": Promise<any>" : ""} {`, ...indent([...text, closing]), "}"); // prettier-ignore
    else if (form === "arrow")
      lines.push(`const find${index} = ${head}${any} => {`, ...indent([...text, closing]), "};");
    else if (form === "method")
      lines.push(`class Finder${index} {`, `  static find${head}${any} {`, ...indent(indent([...text, closing])), "  }", "}"); // prettier-ignore
    else lines.push(`function find${index}${head}${any} {`, ...indent([...text, closing]), "}");
    for (let call = 1 + random.below(4); call > 0; call--) {
      const list = `${listOf()}${listType === ": any[]" ? " as any" : ""}`;
      const given = `${list}, ${random.pick(["0", "1", "3", "4", "8"])}`;
      calls.push(
        form === "generator" ? `[...find${index}(${given})]` : form === "async" ? `await find${index}(${given})` : form === "method" ? `Finder${index}.find(${given})` : `find${index}(${given})`, // prettier-ignore
      );
    }
  }
  const isLooped = random.chance(0.25);
  for (const call of calls)
    lines.push(
      "try {",
      isLooped
        ? `  for (let round = 0; round < 3; round++) console.log(show(${call}));`
        : `  console.log(show(${call}));`,
      "} catch (error) {",
      `  console.log("threw", (error${isTyped ? " as any" : ""}).name);`,
      "}",
    );
  lines.push("console.log(seen, show(keep));");
  const ownNames = /\b(?:find\d|Finder\d|seen|keep|show|isWanted)\b/g;
  return {
    name: `${functionCount}-functions`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(ownNames, name => name + suffix) : line)),
  };
}
export const writeSceneOfLoopExits = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeLoopExits(random, isTypeScript, "printValue", "_" + n).lines;
