// Writes programs whose lists get holes while loops read them. For write-random-sparse-sweep.ts and for a scene of write-ordinary-scenes.ts.
// A hole comes by a store beyond the end, a longer length, delete, splice, copyWithin, concat, flat, reverse, sort, Reflect, defineProperty, another prototype, a copy of a sparse list, an alias, a callback of a built-in, a generator, behind an await or in a try that throws.
// Lists are constants of the file, parameters, fields, captured variables, results and heirs of Array, filled in many ways. They are read by index, backwards, through patterns, for-of, spread, callbacks, as a callee, as a key and stored back.
// Each program prints every result and what the lists hold.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeSparseLists(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const number = isTyped ? ": number" : "";
  const kind = random.pick(["numbers", "numbers", "numbers", "doubles", "words", "objects", "functions", "mixed"]);
  const typed = { numbers: "number[]", doubles: "number[]", words: "string[]", objects: "any[]", functions: "any[]", mixed: "any[]" }[kind]!; // prettier-ignore
  const listType = isTyped ? `: ${random.pick([typed, typed, "any[]", "any"])}` : "";
  const asAny = (text: string) => (isTyped ? `(${text} as any)` : text);
  let nameCount = 0;
  const element = (): string =>
    ({
      numbers: () => random.pick(["1", "2", "3", "7", "0"]),
      doubles: () => random.pick(["0.5", "1.5", "2", "-1.25"]),
      words: () => random.pick(['"a"', '"bc"', '""', '"x"']),
      objects: () => random.pick(["{ v: 1 }", "{ v: 2, w: 3 }", "shared"]),
      functions: () => random.pick([`(x${any}) => x`, "double", `(x${any}) => 1`]),
      mixed: () => random.pick(["1", '"a"', "0.5", "true", "null"]),
    })[kind]!();
  const elements = (least: number, most: number) =>
    Array.from({ length: least + random.below(most) }, element).join(", ");
  const list = (): string =>
    random.pick([
      () => `[${elements(3, 5)}]`,
      () => `[${elements(3, 5)}]`,
      () => `[${elements(3, 5)}]`,
      () => `Array.from({ length: ${3 + random.below(5)} }, () => (${element()}))`,
      () => `new Array(${3 + random.below(4)}).fill(${element()})`,
      () => `${asAny(`[${elements(2, 3)}]`)}.concat([${elements(1, 3)}])`,
      () => `[...[${elements(3, 4)}]]`,
      () => `[${elements(4, 4)}].slice(1)`,
      () => `[${elements(3, 4)}].map((each${any}) => each)`,
      () => `Heir.from([${elements(3, 3)}])`,
      () => `fill(${3 + random.below(4)})`,
      () => "new Array(4)",
      () => asAny(`[${elements(2, 2)}, , ${element()}]`),
      () => (kind === "numbers" || kind === "mixed" ? "JSON.parse('[1,2,3,4]')" : `[${elements(3, 3)}].reverse()`),
    ])();
  /** What makes a hole, or almost one, in `on`. */
  let hasPoke = false;
  const makeHole = (on: string): string => {
    const it = asAny(on);
    if (hasPoke && on === "list0" && random.chance(0.4)) return `poke(${random.below(4)});`;
    return random.pick([
      () => `${on}[${on}.length + ${random.below(3)}] = ${element()};`,
      () => `${on}[${on}.length + 1] = ${element()};`,
      () => `${on}.length += ${1 + random.below(3)};`,
      () => `${on}.length = ${random.below(8)};`,
      () => `delete ${it}[${random.below(4)}];`,
      () => `delete ${it}[${on}.length - 1];`,
      () => `${on}.splice(${random.below(3)}, 1);`,
      () => `${on}.splice(1, 0, ...${asAny("[, " + element() + "]")});`,
      () => `${on}.copyWithin(0, ${1 + random.below(2)});`,
      () => `${on}.reverse();`,
      () => `${on}.sort();`,
      () => `${on}.pop();`,
      () => `${on}.shift();`,
      () => `${on}.unshift(${element()});`,
      () => `Reflect.set(${on}, ${5 + random.below(4)}, ${element()});`,
      () => `Reflect.deleteProperty(${on}, "${random.below(3)}");`,
      () =>
        `Object.defineProperty(${on}, ${random.below(8)}, { ${random.pick([`value: ${element()}, writable: true, configurable: true, enumerable: true`, `get: () => (${element()}), configurable: true`])} });`,
      () => `Object.assign(${on}, { ${6 + random.below(3)}: ${element()} });`,
      () => `Object.setPrototypeOf(${on}, ${random.pick(["above", "Heir.prototype", "Array.prototype"])});`,
      () => `unseen(${on});`,
      () => `[0].forEach(() => {\n  delete ${it}[0];\n});`,
      () => `JSON.stringify([1], (key, value) => {\n  ${on}.length += 1;\n  return value;\n});`,
      () => `try {\n  ${on}[${on}.length + 1] = ${element()};\n  throw new Error();\n} catch {}`,
      () => `Reflect.apply(Array.prototype.push, ${on}, [${element()}]);`,
      () =>
        `const alias${nameCount}${any} = ${on};\nalias${nameCount++}[${random.pick(["7", '"6"', "9"])}] = ${element()};`,
      () => `${it}[${random.pick(["1.5", '"x"', "-1", "2 ** 32"])}] = ${element()};`,
      () => `stepping(${on}).next();`,
      () => `Array.prototype.splice.call(${on}, 0, 1);`,
      () => `${on}.fill(${element()}, ${on}.length, 9);`,
      () => `${it}["${random.below(3)}"] = undefined;`,
    ])();
  };
  /** Another list in place of `on`. */
  const replaced = (on: string): string =>
    random.pick([
      `${on}.concat(${asAny("[, " + element() + "]")})`,
      `[...${on}]`,
      `structuredClone(${kind === "functions" ? "[]" : on})`,
      `${on}.slice()`,
      `Array.from(${on})`,
      `[${on}, ${asAny("[,]")}].flat()`,
      `${on}.map((each${any}) => each)`,
      `${on}.filter(() => true)`,
      `new Array(5)`,
      `Object.assign([], ${on})`,
      `${on}.toSorted()`,
      `${on}.with(0, ${element()})`,
    ]);
  const lines: string[] = [
    "let steps = 0;",
    `const shared${any} = { v: 9 };`,
    `function double(x${any})${any} {\n  return x === undefined ? "none" : x;\n}`,
    `class Heir extends Array${isTyped ? "<any>" : ""} {${random.pick(["", `\n  static get [Symbol.species]() {\n    return Array;\n  }\n`, `\n  get first()${any} {\n    return this[0];\n  }\n`])}}`,
    `const above${any} = Object.setPrototypeOf({ 0: ${element()}, 1: ${element()}, 5: ${element()} }, Array.prototype);`,
    `function fill(count${number})${any} {\n  const made${any} = [];\n  for (let at = 0; at < count; at++) ${random.pick(["made.push", "made[at] = "]) === "made.push" ? `made.push(${element()});` : `made[at] = ${element()};`}\n  return made;\n}`,
    `function unseen(one${any})${any} {\n  ${random.pick(["delete one[1];", "one.length = 2;", "one[one.length + 2] = undefined;", "one.length++;", "return one.sort(() => {\n    one.length = 1;\n    return 0;\n  });"])}\n}`,
    `function* stepping(one${any})${isTyped ? ": any" : ""} {\n  ${random.pick(["delete one[0];", "one.length += 2;", "one[one.length + 1] = 1;"])}\n  yield one;\n}`,
    `function plus(total${any}, one${any})${any} {\n  return (typeof total === "number" ? total : 0) + (typeof one === "number" ? one : one === undefined ? 1000 : typeof one === "string" ? one.length : one === null ? 50 : 7);\n}`,
    `function show(value${any}, depth${number} = 0)${isTyped ? ": string" : ""} {`,
    '  if (typeof value === "function") return "f";',
    "  if (Array.isArray(value)) {",
    '    let text = "[";',
    '    for (let at = 0; at < value.length && at < 14; at++) text += (at in value ? (Object.hasOwn(value, at) ? "" : "^") + show(value[at], depth + 1) : "hole") + ",";',
    '    return text + "]" + value.length;',
    "  }",
    '  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";',
    '  return Object.is(value, -0) ? "-0" : String(value);',
    "}",
  ];
  const fileLists = Array.from({ length: 1 + random.below(2) }, (_, index) => `list${index}`);
  // Now and then the first list lies in a file of its own, which makes holes in it when it is told to, and which imports this file in turn.
  const isApart = suffix === "" && random.chance(0.25);
  const apart: string[] = [];
  hasPoke = isApart;
  for (const name of fileLists) {
    const laid = `${random.pick(["const", "let"])} ${name}${listType} = `;
    if (!isApart || name !== "list0") lines.push(`${laid}${list()};`);
    else {
      const first = `[${elements(3, 4)}]`.replaceAll("shared", "{ v: 4 }").replaceAll("double", "String");
      apart.push(
        `import { turnsOf } from "./program.${isTyped ? "ts" : "mjs"}";`,
        `export ${laid}${isTyped ? `${first} as any` : first};`,
        `export function poke(turn${number})${any} {`,
        ...indent([
          `if (turn === ${random.below(4)}) {`,
          ...indent([
            random.pick([
              `delete ${asAny("list0")}[1];`,
              "list0.length += 2;",
              "list0[list0.length + 1] = list0[0];",
              "list0.length = 1;",
              "list0.reverse();",
              `${asAny("list0")}[8] = undefined;`,
              "list0.splice(0, 1);",
            ]),
          ]),
          "}",
          "return turnsOf();",
        ]),
        "}",
      );
      lines.unshift(`import { list0, poke } from "./other.${isTyped ? "ts" : "mjs"}";`);
      lines.push(`export function turnsOf()${any} {\n  return steps++;\n}`);
    }
  }
  const hasField = random.chance(0.35);
  if (hasField)
    lines.push(
      `class Keeper {\n  rows${listType || any.replace(": any", "")} = ${list()};\n  at${number} = 0;\n  read(i${number})${any} {\n    return this.rows[i];\n  }\n}`,
      "const keeper = new Keeper();",
    );
  const places = [...fileLists, ...fileLists, ...(hasField ? ["keeper.rows", "keeper.rows"] : [])];
  const functionCount = 1 + random.below(3);
  const calls: string[] = [];
  for (let index = 0; index < functionCount; index++) {
    const form = random.pick(["function", "function", "function", "arrow", "generator", "async"]);
    const before: string[] = [];
    const on = random.pick([...places, ...places, "given", "given", "own", "captured"]);
    if (on === "own") before.push(`const own${listType} = ${list()};`);
    if (on === "captured")
      before.push(`let captured${listType} = ${list()};`, `const look = (i${number})${any} => captured[i];`);
    const at = () => random.pick(["i", "i", "i", "i + 1", `${on}.length - 1 - i`, "0", "i - 1", "(i * 3) % (n + 1)"]);
    const read = () =>
      on === "captured" && random.chance(0.4)
        ? `look(${at()})`
        : on === "keeper.rows" && random.chance(0.4)
          ? `keeper.read(${at()})`
          : `${on}[${at()}]`;
    const use = (): string => {
      const one = read();
      const it = isTyped ? `(${one} as any)` : one;
      return random.pick([
        () => `total = plus(total, ${one});`,
        () => `total = plus(total, ${one});`,
        ...(kind === "numbers" || kind === "doubles" ? [() => `total += ${it};`, () => `total = total + ${it} * 2;`, () => `total = (total + ${it}) | 0;`, () => `if (${it} > 1) total += 1;`, () => `total = Math.max(total, ${it});`, () => `total -= ${it} - ${it};`, () => `total ^= ${it};`] : []), // prettier-ignore
        ...(kind === "words"
          ? [
              () => `text += ${it};`,
              () => `total += ${it}.length;`,
              () => `if (${it} < "b") total += 1;`,
              () => `text += \`\${${it}}\`;`,
            ]
          : []),
        ...(kind === "objects"
          ? [
              () => `total += ${it}.v;`,
              () => `total += ${it}?.v ?? 100;`,
              () => `if (${it} === shared) total += 1;`,
              () => `${it}.v += 1;`,
            ]
          : []),
        ...(kind === "functions"
          ? [
              () => `total = plus(total, ${it}(i));`,
              () => `total = plus(total, ${it}?.(i));`,
              () => `total = plus(total, ${on}[${at()}](1));`,
            ]
          : []),
        () => `if (${it} === undefined) total = plus(total, 5);`,
        () => `text += typeof ${it} + ",";`,
        () => `total = plus(total, ${it} ?? 3);`,
        () => `if (${it}) total = plus(total, 1);`,
        () => `total = plus(total, counts[${it}]);`,
        () =>
          `counts[String(${kind === "objects" || kind === "functions" ? `typeof ${it}` : it})] = (counts[String(${kind === "objects" || kind === "functions" ? `typeof ${it}` : it})] ?? 0) + 1;`,
        () => `if (${at()} in ${on}) total = plus(total, 2);`,
        () => `${on}[${random.pick(["i", "0", "i + 1"])}] = ${one};`,
        () => `last = ${one};`,
        () => `if (last !== ${one}) total = plus(total, 1);`,
      ])();
    };
    const walk = (): string[] => {
      const inner = Array.from({ length: 1 + random.below(2) }, use);
      if (random.chance(0.3))
        inner.splice(
          random.below(inner.length + 1),
          0,
          `if (i === ${random.below(4)}) {`,
          ...indent([makeHole(on)]),
          "}",
        );
      return random.pick([
        () => [`for (let i = 0; i < ${random.pick([`${on}.length`, "n", `${on}.length + 1`])}${random.pick(["", " && i < 12"])}; i++) {`.replace(`${on}.length; `, `${on}.length && i < 14; `).replace(`${on}.length + 1; `, `${on}.length + 1 && i < 14; `), ...indent(inner), "}"], // prettier-ignore
        () => [`for (let i = 0; i < n; i++) {`, ...indent(inner), "}"],
        () => [
          `for (let i = ${random.pick([`${on}.length - 1`, "n", `${on}.length`])}; i >= 0; i--) {`,
          ...indent(inner),
          "}",
        ],
        () => [`{`, `  let i = 0;`, `  while (i < 8) {`, ...indent(indent(inner)), "    i++;", "  }", "}"],
        () => [
          `for (let turn = 0; turn < 2; turn++) {`,
          `  for (let i = 0; i < n; i++) {`,
          ...indent(indent(inner)),
          "  }",
          "}",
        ],
        () => [`for (const one of ${on}) total = plus(total, one);`],
        () => [`${on}.forEach((one${any}) => {\n  total = plus(total, one);\n});`],
        () => [
          `total = plus(total, ${on}.reduce((sum${any}, one${any}) => plus(sum, one), 0)${isTyped ? " as any" : ""});`,
        ],
        () => [`text += ${on}.map((one${any}) => typeof one).join("");`],
        () => [
          `const [a${nameCount}, b${nameCount} = ${element()}, , d${nameCount}]${any} = ${on};`,
          `total = plus(plus(total, a${nameCount}), plus(b${nameCount}, d${nameCount++}));`,
        ],
        () => [`total = plus(total, [...${on}].length);`],
        () => [`text += ${on}.findIndex((one${any}) => one === undefined) + ",";`],
        () => [
          `text += ${on}.indexOf(undefined${isTyped ? " as any" : ""}) + "," + ${on}.includes(undefined${isTyped ? " as any" : ""});`,
        ],
        () => [`for (const key in ${on}) text += key;`],
      ])();
    };
    const body: string[] = [];
    for (let count = 1 + random.below(3); count > 0; count--) {
      body.push(...walk());
      if (random.chance(0.55))
        body.push(
          random.chance(0.5)
            ? `if (n ${random.pick(["> 2", "=== 3", "& 1"])}) {\n${indent([makeHole(on)]).join("\n")}\n}`
            : `{\n${indent([makeHole(on)]).join("\n")}\n}`,
        );
      if (form === "async" && random.chance(0.4)) body.push("await null;");
      if (form === "generator" && random.chance(0.4)) body.push("yield total;");
      if (on === "captured" && random.chance(0.3)) body.push(`captured = ${replaced("captured")};`);
    }
    const text = [
      `let total${any} = 0;`,
      'let text = "";',
      `let last${any};`,
      `const counts${any} = {};`,
      ...before,
      ...body,
    ];
    const result = `[total, text.slice(0, 120), show(last), Object.keys(counts).join()].join("|")`;
    const head = `(given${listType}, n${number})`;
    if (form === "generator")
      lines.push(
        `function* work${index}${head}${isTyped ? ": any" : ""} {`,
        ...indent([...text, `yield ${result};`]),
        "}",
      );
    else if (form === "async")
      lines.push(
        `async function work${index}${head}${isTyped ? ": Promise<any>" : ""} {`,
        ...indent([...text, `return ${result};`]),
        "}",
      );
    else if (form === "arrow")
      lines.push(`const work${index} = ${head}${any} => {`, ...indent([...text, `return ${result};`]), "};");
    else lines.push(`function work${index}${head}${any} {`, ...indent([...text, `return ${result};`]), "}");
    for (let count = 1 + random.below(3); count > 0; count--) {
      const given = `${random.chance(0.6) ? list() : random.pick(fileLists)}, ${random.pick(["2", "3", "5", "9"])}`;
      const call =
        form === "generator"
          ? `[...work${index}(${given})].join()`
          : form === "async"
            ? `await work${index}(${given})`
            : `work${index}(${given})`;
      calls.push(
        "try {",
        `  console.log(${call});`,
        "} catch (error) {",
        `  console.log("threw", (error${isTyped ? " as any" : ""})?.name);`,
        "}",
        `console.log(${fileLists.map(name => `show(${name})`).join(", ")}${hasField ? ", show(keeper.rows)" : ""});`,
      );
      if (random.chance(0.3)) calls.push("try {", ...indent([makeHole(random.pick(fileLists))]), "} catch {}");
    }
  }
  lines.push(...calls, "console.log(steps, shared.v);");
  const ownNames =
    /(?<![.\w"'])(?:work\d|list\d|steps|shared|double|Heir|above|fill|unseen|stepping|plus|show|Keeper|keeper)(?![\w"'])/g;
  return {
    name: `${kind}--${functionCount}-functions${isApart ? "--two-files" : ""}`,
    apart,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(ownNames, each => each + suffix).replace(/\.\.\.(work\d|list\d|stepping|keeper)\b(?!_)/g, (_, each) => "..." + each + suffix) : line)), // prettier-ignore
  };
}
export const writeSceneOfSparseLists = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeSparseLists(random, isTypeScript, "printValue", "_" + n).lines;
