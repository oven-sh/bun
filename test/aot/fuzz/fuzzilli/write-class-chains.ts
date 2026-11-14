// Writes programs of classes that extend each other. For write-random-class-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Fields have initializers that call functions and may throw, constructors hand `this` out before they end, throw, return another object or look at new.target, methods and accessors override each other and call super, and there are private members, static blocks, computed keys and mixins.
// Each program constructs the classes in loops and prints what every object holds, also one whose constructor did not end.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeClassChains(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const any = isTyped ? ": any" : "";
  const self = isTyped ? "(this as any)" : "this";
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const classCount = 2 + random.below(3);
  const fieldNames = ["size", "name", "list", "extra"];
  const lines: string[] = [
    "let steps = 0;",
    `let leaked${any} = null;`,
    `function step(value${any})${any} {`,
    "  steps++;",
    random.pick([
      `  if (steps % ${3 + random.below(9)} === ${random.below(3)}) throw new Error("step " + steps);`,
      `  if (steps === ${3 + random.below(20)}) throw new Error("step " + steps);`,
      "  if (steps > 4000) throw new Error();",
    ]),
    "  return value;",
    "}",
    `function leak(value${any})${any} {`,
    "  leaked = value;",
    "  return value;",
    "}",
  ];
  const value = () =>
    random.pick([
      "1",
      "step(2)",
      'step("text")',
      "[step(3)]",
      "steps",
      "0.5",
      `${self}.size`,
      `${self}.name ?? "none"`,
      `() => ${self}.size`,
      `${self}.method?.()`,
      "step(undefined)",
      "null",
      `leak(this)`,
    ]);
  for (let index = 0; index < classCount; index++) {
    const base = index === 0 ? undefined : random.chance(0.15) ? `mixin(Kind${index - 1})` : `Kind${index - 1}`;
    const parts: string[][] = [];
    const hasPrivate = random.chance(0.35);
    if (hasPrivate)
      parts.push(
        [`#hidden${any} = ${random.pick(["step(7)", "1", "0.5"])};`],
        [
          "seen() {",
          random.pick(["  return this.#hidden;", "  return ++this.#hidden;", "  return #hidden in this;"]),
          "}",
        ],
      );
    const fields = fieldNames.filter(() => random.chance(index === 0 ? 0.6 : 0.4));
    for (const field of fields) {
      const form = random.below(8);
      parts.push(
        form === 0
          ? [`${field}${any};`]
          : form === 1
            ? [`["${field}"]${any} = ${value()};`]
            : form === 2 && index > 0
              ? [
                  `get ${field}()${any} {`,
                  `  return ${random.pick(["5", `steps`, '"got"'])};`,
                  "}",
                  `set ${field}(value${any}) {`,
                  `  ${random.pick(["steps += 0;", "leaked = value;", `${self}.other = value;`])}`,
                  "}",
                ]
              : [`${field}${any} = ${value()};`],
      );
    }
    if (random.chance(0.6))
      parts.push([
        "method()" + any + " {",
        `  return ${random.pick([`"m${index}"`, ...(index > 0 ? [`"m${index}" + super.method?.()`] : []), `${self}.size`, `typeof ${self}.name + "!"`, "step(steps)"])};`,
        "}",
      ]);
    if (random.chance(0.35))
      parts.push([
        "get total()" + any + " {",
        `  return ${random.pick([`${self}.size`, ...(index > 0 ? ["super.total"] : []), "steps", `${self}.method?.()`])};`,
        "}",
      ]);
    if (random.chance(0.25))
      parts.push([`static count${any} = ${random.pick(["0", "steps", `${index > 0 ? "super.count ?? 4" : "4"}`])};`]);
    if (random.chance(0.2))
      parts.push([
        "static {",
        `  ${isTyped ? "(this as any)" : "this"}.made = ${random.pick(["steps", '"block"', index > 0 ? "super.made + 1" : "1"])};`,
        "}",
      ]);
    if (random.chance(0.2))
      parts.push([
        `static of(...given${isTyped ? ": any[]" : ""})${any} {`,
        `  return new ${isTyped ? "(this as any)" : "this"}(...given);`,
        "}",
      ]);
    if (random.chance(0.7)) {
      const before = random.pick([
        [],
        [],
        ["step(0);"],
        [`if (value === ${random.below(4)}) throw new Error("before ${index}");`],
      ]);
      const after: string[] = index === 0 && random.chance(0.5) ? ["leak(this);"] : [];
      for (let part = random.below(4); part > 0; part--)
        after.push(
          random.pick([
            `${self}.${random.pick(fieldNames)} = ${random.pick(["value", "step(value)", "value + 0.5", "[value]", '"set"', "leak(this) && 1"])};`,
            `${self}.${random.pick(fieldNames)} = ${random.pick(["value", "value"])};`,
            `if (value === ${random.below(4)}) throw new Error("after ${index}");`,
            "leak(this);",
            `if (new.target === Kind${index}) ${self}.own = true;`,
            `if (value === 3) return ${random.pick(["{ size: 99 }", "this", "undefined", ...(index === 0 ? ["{ size: value }"] : [])])}${isTyped ? " as any" : ""};`,
            `delete ${self}.${random.pick(fieldNames)};`,
            `Object.freeze(${random.pick(["this", `${self}.list ?? {}`])});`,
            `for (let i = 0; i < 2; i++) ${self}.size = (${self}.size | 0) + i;`,
            `${self}.method?.();`,
          ]),
        );
      parts.push([
        `constructor(value${any}${random.chance(0.3) ? " = step(1)" : ""}) {`,
        ...indent([
          ...(base
            ? [...before, `super(${random.pick(["value", "value", "value + 1", "step(value)", ""])});`]
            : before),
          ...after,
        ]),
        "}",
      ]);
    }
    // TypeScript wants what the class declares in some order; the members of the generator may stand in any.
    for (let at = parts.length - 1; at > 0; at--)
      if (random.chance(0.4)) [parts[at], parts[at - 1]] = [parts[at - 1], parts[at]];
    const head = base ? ` extends ${isTyped ? `(${base} as any)` : base}` : "";
    if (index === 1)
      lines.push(
        `function mixin(base${any})${any} {`,
        `  return class extends base {`,
        `    mixed${any} = ${random.pick(["step(5)", "1", `${self}.size`])};`,
        ...(random.chance(0.4) ? [`    method()${any} {`, '      return "mixed " + super.method?.();', "    }"] : []),
        "  };",
        "}",
      );
    lines.push(
      random.chance(0.2) ? `const Kind${index}${any} = class${head} {` : `class Kind${index}${head} {`,
      ...indent(parts.flat()),
      random.chance(0) ? "};" : "}",
    );
  }
  const construct = (index: string) =>
    random.pick([
      `new ${isTyped ? `(Kind${index} as any)` : `Kind${index}`}(round)`,
      `new ${isTyped ? `(Kind${index} as any)` : `Kind${index}`}(round)`,
      `Reflect.construct(Kind${index}, [round]${random.chance(0.5) ? `, Kind${random.below(classCount)}` : ""})`,
      `(${isTyped ? `(Kind${index} as any)` : `Kind${index}`}.of ? ${isTyped ? `(Kind${index} as any)` : `Kind${index}`}.of(round) : new ${isTyped ? `(Kind${index} as any)` : `Kind${index}`}(round))`,
    ]);
  lines.push(
    `function show(value${any})${any} {`,
    '  if (value === null || typeof value !== "object") return String(value);',
    '  const own = Reflect.ownKeys(value).map(key => String(key) + "=" + (typeof value[key] === "function" ? "f" : typeof value[key] === "object" && value[key] !== null ? (value[key] === value ? "self" : "o") : String(value[key])));',
    '  return own.join(" ");',
    "}",
    `function use(value${any})${any} {`,
    `  const out${isTyped ? ": any[]" : ""} = [show(value)];`,
    '  for (const key of ["method", "seen"]) if (typeof value[key] === "function") out.push(key + ":" + show(value[key]()));',
    '  for (const key of ["total", "size", "name", "mixed", "own"]) if (key in value) out.push(key + "=" + (typeof value[key] === "function" ? "f" : show(value[key])));',
    ...Array.from({ length: classCount }, (_, index) => `  if (value instanceof Kind${index}) out.push("k${index}");`),
    '  return out.join("; ");',
    "}",
  );
  for (let index = 0; index < classCount; index++)
    lines.push(
      `for (let round = 0; round < ${random.pick(["2", "4", "5"])}; round++) {`,
      "  try {",
      ...indent(indent([`const made${any} = ${construct(String(index))};`, "console.log(round, use(made));"])),
      "  } catch (error) {",
      `    console.log(round, "threw", (error${isTyped ? " as any" : ""}).message ?? "", show(leaked));`,
      "  }",
      "}",
      `console.log("static ${index}", ${isTyped ? `(Kind${index} as any)` : `Kind${index}`}.count, ${isTyped ? `(Kind${index} as any)` : `Kind${index}`}.made, typeof ${isTyped ? `(Kind${index} as any)` : `Kind${index}`}.of);`,
    );
  lines.push('console.log("steps", steps, show(leaked));');
  // What a class does when it is defined may throw too.
  const ownNames = /\b(?:Kind\d|steps|leaked|step|leak|mixin|show|use)\b/g;
  return {
    name: `${classCount}-classes`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "(").replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfClassChains = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeClassChains(random, isTypeScript, "printValue", "_" + n).lines;
