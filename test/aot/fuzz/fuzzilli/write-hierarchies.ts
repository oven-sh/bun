// Writes programs of constructor functions and classes over each other. For write-random-hierarchy-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Members lie on prototypes, constructors and objects under names that several of them have. They are laid, replaced by values, accessors and other functions, wrapped, deleted and frozen, before and behind the first objects and the first calls.
// Functions read a member as a truth, by typeof, by a call, under a computed key, with ?. and beside instanceof, in loops and once, over objects of several levels.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeHierarchies(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const self = isTyped ? "this: any" : "";
  const selfAnd = isTyped ? "this: any, " : "";
  const asAny = (text: string) => (isTyped ? `(${text} as any)` : text);
  const names = ["run", "size", "kind", "step", "next"].slice(0, 2 + random.below(4));
  const name = () => random.pick(names);
  let count = 0;
  const value = () => random.pick(["0", "1", "1.5", "-0", "NaN", "true", "false", '"text"', '""', "null", "undefined", "[]", "{}", "7n", String(random.below(90))]); // prettier-ignore
  const func = (): string =>
    random.pick([
      `function (${self})${any} {\n  return "f${count++}" + (this.a || 0);\n}`,
      `function (${selfAnd}x${any})${any} {\n  return this.a + ${random.below(9)} + (x | 0);\n}`,
      `function (${self})${any} {\n  return ${random.below(9)} + (this.b | 0);\n}`,
      `(x${any})${any} => (x | 0) + ${random.below(9)}`,
      `function (${self})${any} {\n  return this;\n}`,
      `function (${self})${any} {\n  this.b = (this.b | 0) + 1;\n  return this.b;\n}`,
      "shared",
    ]);
  const member = () => (random.chance(0.6) ? func() : value());
  const kinds = 2 + random.below(4);
  const isClass: boolean[] = [];
  const parent: (number | undefined)[] = [];
  const lines: string[] = [
    `const out${isTyped ? ": string[]" : ""} = [];`,
    `function tell(label${any}, read${any})${any} {`,
    `  let result${any};`,
    "  try {",
    "    result = read();",
    "  } catch (error) {",
    `    result = "!" + (error${isTyped ? " as any" : ""}).name;`,
    "  }",
    '  out.push(label + "=" + (typeof result === "function" ? "function" : typeof result === "object" && result !== null ? "object" : Object.is(result, -0) ? "-0" : String(result)));',
    "}",
    `function shared(${selfAnd}x${isTyped ? "?: any" : ""})${any} {\n  return (x | 0) + 100;\n}`,
  ];
  const proto = (kind: number) => `${asAny("Kind" + kind)}.prototype`;
  const change = (kind: number, objects: string[], known = kinds): string => {
    const key = name();
    const on = proto(kind);
    const object = objects.length ? random.pick(objects) : undefined;
    return random.pick([
      () => `${on}.${key} = ${func()};`,
      () => `${on}.${key} = ${func()};`,
      () => `${on}.${key} = ${value()};`,
      () => `${on}.${key} = ${value()};`,
      () =>
        `Object.defineProperty(${on}, "${key}", { get: function (${self})${any} {\n  return ${random.pick(['"g" + this.a', "this.b", "undefined", "shared"])};\n}, configurable: true, enumerable: ${random.pick(["true", "false"])} });`,
      () =>
        `Object.defineProperty(${on}, "${key}", { value: ${member()}, configurable: true, writable: ${random.pick(["true", "false"])} });`,
      () => `${asAny("Kind" + kind)}.${key} = ${member()};`,
      () => `delete ${on}.${key};`,
      () =>
        `const wrapped${count}${any} = ${on}.${key};\n${on}.${key} = function (${self})${any} {\n  return "w" + (typeof wrapped${count} === "function" ? wrapped${count}.call(this, 1) : wrapped${count++});\n};`,
      () => `${on}["${key}"] = ${member()};`,
      () => `Object.assign(${on}, { ${key}: ${value()}, extra: 1 });`,
      () => `Object.freeze(${on});`,
      () =>
        `${asAny("Kind" + kind)}.prototype = Object.assign(Object.create(Object.getPrototypeOf(${on})), { constructor: Kind${kind}, ${key}: ${member()} });`,
      () => `Object.setPrototypeOf(${on}, ${random.chance(0.6) ? proto(random.below(known)) : "null"});`,
      ...(object
        ? [
            () => `${asAny(object)}.${key} = ${member()};`,
            () => `delete ${asAny(object)}.${key};`,
            () => `Object.setPrototypeOf(${object}, ${proto(random.below(known))});`,
          ]
        : []),
    ])();
  };
  const attempt = (text: string) => [
    "try {",
    ...indent([text]),
    "} catch (error) {",
    `  out.push((error${isTyped ? " as any" : ""}).name);`,
    "}",
  ];
  const objects: string[] = [];
  const mixin = random.chance(0.3);
  if (mixin)
    lines.push(
      `const mix = (Base${any})${any} =>`,
      "  class extends Base {",
      `    ${name()}(x${any})${any} {`,
      `      return ${random.pick([`super.${name()}?.(x) ?? 5`, '"mixed"', "this.a"])};`,
      "    }",
      "  };",
    );
  for (let kind = 0; kind < kinds; kind++) {
    const above = kind > 0 && random.chance(0.85) ? random.below(kind) : undefined;
    parent[kind] = above;
    isClass[kind] = random.chance(above === undefined ? 0.3 : 0.5);
    if (isClass[kind]) {
      const base =
        above === undefined
          ? ""
          : mixin && random.chance(0.3)
            ? ` extends mix(Kind${above})`
            : ` extends ${isTyped ? `(Kind${above} as any)` : `Kind${above}`}`;
      const methods = names
        .filter(() => random.chance(0.4))
        .map(each =>
          random.pick([
            () => [
              `${each}(x${any})${any} {`,
              `  return ${random.pick([`"c${kind}" + this.a`, `this.b + (x | 0)`, ...(above === undefined ? [] : [`${isTyped ? "(super." + each + " as any)" : "super." + each}?.call?.(this, x)`]), "this"])};`,
              "}",
            ],
            () => [`get ${each}()${any} {`, `  return ${random.pick(["this.a", "shared", '"got"'])};`, "}"],
            () => [`${each}${any} = ${member()};`],
            () => [`static ${each}${any} = ${member()};`],
          ])(),
        );
      lines.push(
        `class Kind${kind}${base} {`,
        ...(isTyped ? ["  [key: string]: any;"] : []),
        `  constructor(a${any}) {`,
        ...(above === undefined ? [] : ["    super(a);"]),
        "    this.a = a;",
        `    this.b = ${kind};`,
        "  }",
        ...methods.flatMap(method => indent(method)),
        "}",
      );
    } else {
      const calls = above !== undefined && !isClass[above] && random.chance(0.6);
      lines.push(
        `function Kind${kind}(${selfAnd}a${any}) {`,
        ...(calls ? [`  ${asAny("Kind" + above)}.call(this, a);`] : []),
        "  this.a = a;",
        `  this.b = ${kind};`,
        ...(random.chance(0.25) ? [`  this.${name()} = ${member()};`] : []),
        "}",
      );
      if (above !== undefined)
        lines.push(
          ...attempt(
            random.pick([
              `${asAny("Kind" + kind)}.prototype = Object.create(${proto(above)});\n${proto(kind)}.constructor = Kind${kind};`,
              `${asAny("Kind" + kind)}.prototype = Object.create(${proto(above)}, { constructor: { value: Kind${kind}, writable: true, configurable: true } });`,
              `Object.setPrototypeOf(${proto(kind)}, ${proto(above)});`,
              `${asAny("Kind" + kind)}.prototype = new ${isTyped ? `(Kind${above} as any)` : "Kind" + above}(0);`,
            ]),
          ),
        );
      for (const each of names.filter(() => random.chance(0.55)))
        lines.push(
          ...(random.chance(0.3) || kind > 0
            ? attempt(`${proto(kind)}.${each} = ${member()};`)
            : [`${proto(kind)}.${each} = ${member()};`]),
        );
    }
    for (let times = random.below(3); times > 0; times--)
      lines.push(...attempt(change(random.below(kind + 1), objects, kind + 1)));
    if (random.chance(0.6)) {
      lines.push(
        `let object${kind}${any};`,
        ...attempt(`object${kind} = new ${isTyped ? `(Kind${kind} as any)` : "Kind" + kind}(${kind + 1});`),
      );
      objects.push(`object${kind}`);
      if (random.chance(0.4))
        lines.push(
          `tell("early${kind}", () => ${random.pick([`object${kind}.${name()}?.(1)`, `object${kind}.${name()} ? 1 : 2`])});`,
        );
    }
  }
  const read = (): string => {
    const key = name();
    return random.pick([
      `o.${key} ? "y" : "n"`,
      `o.${key} ? "y" : "n"`,
      `typeof o.${key}`,
      `typeof o.${key} === "function" ? o.${key}(k) : o.${key}`,
      `o.${key}`,
      `o.${key}(k)`,
      `o.${key}?.(k)`,
      `o["${key}"]`,
      `o[names[k % names.length]]`,
      `!o.${key}`,
      `o.${key} || "none"`,
      `o.${key} ?? "none"`,
      `o.${key} && 1`,
      `o.${key} === o.${name()}`,
      `"${key}" in o`,
      `Object.hasOwn(o, "${key}")`,
      `o instanceof ${isTyped ? `(Kind${random.below(kinds)} as any)` : `Kind${random.below(kinds)}`} ? o.${key} : "other"`,
      `(o.constructor${isTyped ? " as any" : ""}).${key}`,
      `o.a + o.b`,
    ]);
  };
  lines.push(`const names = [${names.map(each => `"${each}"`).join(", ")}];`);
  const readers = 1 + random.below(3);
  for (let index = 0; index < readers; index++) {
    const body = Array.from({ length: 1 + random.below(4) }, (_, at) => `tell("r${index}${at}", () => ${read()});`);
    const direct = Array.from(
      { length: random.below(3) },
      () => `try {\n  if (o.${name()}) total += 1;\n  else total += 100;\n} catch {\n  total += 10000;\n}`,
    );
    lines.push(
      `function use${index}(o${any}, times${any})${any} {`,
      "  let total = 0;",
      "  for (let k = 0; k < times; k++) {",
      ...indent(indent([...body, ...direct])),
      "  }",
      '  out.push("t" + total);',
      "}",
    );
  }
  const made = (kind: number) => `new ${isTyped ? `(Kind${kind} as any)` : "Kind" + kind}(${random.below(9)})`;
  for (let times = 3 + random.below(7); times > 0; times--)
    lines.push(
      ...attempt(
        random.pick([
          () => change(random.below(kinds), objects),
          () => change(random.below(kinds), objects),
          () =>
            `use${random.below(readers)}(${objects.length && random.chance(0.5) ? random.pick(objects) : made(random.below(kinds))}, ${random.pick(["1", "2", "5"])});`,
          () => `use${random.below(readers)}(${made(random.below(kinds))}, ${random.pick(["1", "3"])});`,
          () =>
            `for (const o of [${Array.from({ length: kinds }, (_, kind) => made(kind)).join(", ")}]) use${random.below(readers)}(o, 2);`,
          () =>
            `tell("i", () => ${made(random.below(kinds))} instanceof ${isTyped ? `(Kind${random.below(kinds)} as any)` : `Kind${random.below(kinds)}`});`,
          () =>
            `tell("s", () => typeof ${asAny("Kind" + random.below(kinds))}.${name()} + Object.keys(${proto(random.below(kinds))}).join());`,
        ])(),
      ),
    );
  for (const object of objects) lines.push(...attempt(`use${random.below(readers)}(${object}, 1);`));
  lines.push('console.log(out.join("\\n"));');
  return {
    name: `${kinds}-kinds${mixin ? "--mixin" : ""}`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line =>
        suffix
          ? line.replace(
              /(?<![.\w"'])(?:Kind\d|object\d|use\d|out|tell|shared|mix|names|wrapped\d+)(?![\w"'])/g,
              each => each + suffix,
            )
          : line,
      ),
  };
}
export const writeSceneOfHierarchies = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeHierarchies(random, isTypeScript, "printValue", "_" + n).lines;
