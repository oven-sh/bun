// Writes programs whose classes get other methods while they run. For write-random-replaced-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Methods, accessors, static methods and constructors are wrapped, replaced, deleted and given back, on a prototype, on one object, by Object.assign, by defineProperty, by a decorator (TypeScript) or by a function that makes classes out of classes.
// Loops call them by name, by key, by super, as callbacks, bound, by call and by apply, over objects of several classes, before, behind and between the changes.
// Each program prints every result.

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeReplacedMethods(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const anys = isTyped ? ": any[]" : "";
  const self = isTyped ? "this: any, " : "";
  const asAny = (text: string) => (isTyped ? `(${text} as any)` : text);
  const methods = ["run", "size", "name"];
  const classCount = 2 + random.below(2);
  const hasDecorators = isTyped && random.chance(0.4);
  const value = (from: string[]): string => random.pick([...from, "1", "2", "0.5", `${random.pick(from)} + 1`, `${random.pick(from)} * 2`, '"t"', "this.count", "this.count++", "steps"]); // prettier-ignore
  const lines: string[] = [
    `let steps${isTyped ? ": number" : ""} = 0;`,
    `const told${anys} = [];`,
    `function note(one${any})${any} {`,
    '  if (told.length < 60) told.push(typeof one === "object" && one !== null ? one.constructor?.name ?? "object" : typeof one === "function" ? "function" : Object.is(one, -0) ? "-0" : String(one));',
    "  return one;",
    "}",
    `function wrapped(original${any}, by${any})${any} {`,
    `  return function (${self}...given${anys})${any} {`,
    `    ${random.pick(["if (steps++ > 900) return by;", "note(by);\n    if (steps++ > 900) return by;", "if (steps++ > 40) return by;"])}`,
    `    return ${random.pick(["original.apply(this, given)", "original.call(this, ...given)", "original.call(this, given[0])", "plus(original.apply(this, given), by)", "Reflect.apply(original, this, given)"])};`,
    "  };",
    "}",
    `function plus(one${any}, two${any})${any} {`,
    '  return typeof one === "number" && typeof two === "number" ? one + two : String(one).length + (two ? 1 : 0);',
    "}",
  ];
  if (hasDecorators)
    lines.push(
      `function counts(target${any}, context${any})${any} {`,
      random.pick([
        '  if (typeof target === "function" && context && context.kind === "method") return wrapped(target, 1);',
        '  if (context && context.kind === "method") {\n    return function (this: any, ...given: any[]): any {\n      if (steps++ > 900) return 0;\n      return target.apply(this, given);\n    };\n  }',
        "  steps++;",
      ]),
      "}",
      `function sealed(target${any}, context${any})${any} {`,
      random.pick(["  steps += 2;", '  if (context && context.kind === "class") return class extends target {\n    extra = 1;\n    run(one: any): any {\n      return plus(super.run(one), 1);\n    }\n  };']), // prettier-ignore
      "}",
      `function starts(target${any}, context${any})${any} {`,
      random.pick([
        "  return (first: any) => first;",
        '  return (first: any) => (typeof first === "number" ? first + 1 : first);',
        "  steps++;",
      ]),
      "}",
    );
  const body = (isHeir: boolean, method: string): string =>
    random.pick([
      `return ${value(["one"])};`,
      `return plus(this.count, ${value(["one"])});`,
      `this.count += 1;\nreturn this.count;`,
      ...(isHeir ? [`return plus(super.${method}(one), ${value(["one"])});`, `return super.${method}(one);`] : []),
      `if (one > 3) return ${value(["one"])};\nreturn plus(one, this.count);`,
      `for (let at = 0; at < 2; at++) this.count += at;\nreturn this.count;`,
      `return note(${value(["one"])});`,
    ]);
  const makeNames: string[] = [];
  for (let index = 0; index < classCount; index++) {
    const isMixed = index > 0 && random.chance(0.25);
    const isHeir = index > 0 && (isMixed || random.chance(0.7));
    const decorator = (word: string) => (hasDecorators && random.chance(0.4) ? word + " " : "");
    const parts = [
      `  ${hasDecorators && random.chance(0.3) ? "@starts " : ""}count${any} = ${random.pick(["0", "1", "2.5"])};`,
      ...(isHeir ? [] : [`  static made${any} = 0;`]),
      ...(!isHeir || random.chance(0.4) ? [`  constructor(one${any} = 0) {`, ...(isHeir ? ["    super(one);"] : []), "    this.count = one;", "    (this.constructor" + (isTyped ? " as any" : "") + ").made++;", "  }"] : []), // prettier-ignore
      ...methods
        .filter(method => !isHeir || random.chance(0.6))
        .flatMap(method => [`  ${decorator("@counts")}${method}(one${any})${any} {`, ...indent(indent([body(isHeir, method)])), "  }"]), // prettier-ignore
      ...(isHeir && random.chance(0.6) ? [] : [`  get half()${any} {`, "    return this.count / 2;", "  }", `  set half(one${isTyped ? ": any" : ""}) {`, "    this.count = one * 2;", "  }"]), // prettier-ignore
      ...(isHeir && random.chance(0.5) ? [] : [`  static of(one${any})${any} {`, `    return ${random.pick([isTyped ? "new (this as any)(one)" : "new this(one)", "plus(one, this.made)", "this.made"])};`, "  }"]), // prettier-ignore
    ];
    if (isMixed) {
      lines.push(`const mix${index} = (Base${any})${any} =>`, "  class extends Base {", ...indent(parts.map(line => line.replace(/@\w+ /, ""))), "  };", `const Kind${index}${any} = mix${index}(${random.chance(0.3) ? `mix${index}(Kind${index - 1})` : `Kind${index - 1}`});`); // prettier-ignore
    } else
      lines.push(
        `${decorator("@sealed")}class Kind${index}${isHeir ? ` extends Kind${index - 1}` : ""} {`,
        ...parts,
        "}",
      );
    makeNames.push(`Kind${index}`);
  }
  const kind = () => random.pick(makeNames);
  const method = () => random.pick(methods);
  let nameCount = 0;
  const proto = (name: string) => `${asAny(name)}.prototype`;
  const replacement = (key: string) =>
    random.pick([
      `function (${self}one${any})${any} {\n  return plus(this.count, ${value(["one"]).replace("this.count++", "one")});\n}`,
      `function (${self}one${any})${any} {\n  this.count = ${random.pick(["9", "one"])};\n  return one;\n}`,
      `(one${any})${any} => ${random.pick(["one", "steps", '"arrow"', "plus(one, 5)"])}`,
      `${proto(kind())}.${method()}`,
      `wrapped(${proto(kind())}.${key}, ${random.pick(["1", '"w"', "0"])})`,
    ]);
  const change = (objects: string[]): string[] => {
    const [name, key] = [kind(), method()];
    const object = objects.length ? random.pick(objects) : undefined;
    return random.pick([
      () => [`${proto(name)}.${key} = ${replacement(key)};`],
      () => [`${proto(name)}.${key} = ${replacement(key)};`],
      () => { const held = `original${nameCount++}`; return [`const ${held}${any} = ${proto(name)}.${key};`, `${proto(name)}.${key} = function (${self}...given${anys})${any} {`, `  if (steps++ > 900) return 0;`, `  return ${random.pick([`${held}.apply(this, given)`, `${held}.call(this, given[0])`])};`, "};"]; }, // prettier-ignore
      () => [`delete ${proto(name)}.${key};`],
      () => [`Object.assign(${proto(name)}, { ${key}: ${replacement(key)} });`],
      () => [
        `Object.defineProperty(${proto(name)}, "${key}", { value: ${replacement(key)}, configurable: true, writable: ${random.pick(["true", "false"])} });`,
      ],
      () => [
        `Object.defineProperty(${proto(name)}, "half", { get() {\n  return ${random.pick(["7", "steps"])};\n}, configurable: true });`,
      ],
      () => [
        `${asAny(name)}.of = ${random.pick([`(one${any}) => new ${isTyped ? `(${name} as any)` : name}(one)`, `wrapped(${asAny(name)}.of, 1)`, `(one${any}) => one`])};`,
      ],
      ...(object ? [() => [`${asAny(object)}.${key} = ${replacement(key)};`], () => [`delete ${asAny(object)}.${key};`], () => [`Object.setPrototypeOf(${object}, ${proto(kind())});`]] : []), // prettier-ignore
      () => [`${proto(name)}["${key}"] = ${replacement(key)};`],
    ])();
  };
  const functionCount = 1 + random.below(2);
  const calls: string[] = [];
  for (let index = 0; index < functionCount; index++) {
    const use = (): string[] => {
      const object = random.pick(["one", "one", "one", "first", "all[turn % all.length]"]);
      const key = method();
      return random.pick([
        () => [`total = plus(total, ${object}.${key}(turn));`],
        () => [`total = plus(total, ${object}.${key}(turn));`],
        () => [`total = plus(total, ${object}.${key}(${random.pick(["2", "total", '"t"', "0.5"])}));`],
        () => [`total = plus(total, ${object}["${key}"](turn));`],
        () => [`total = plus(total, ${object}.${key}.call(${random.pick(["one", "first"])}, turn));`],
        () => [`total = plus(total, ${object}.${key}.apply(first, [turn]));`],
        () => [
          `const bound${nameCount}${any} = ${object}.${key}.bind(${random.pick(["one", "first"])});`,
          `total = plus(total, bound${nameCount++}(turn));`,
        ],
        () => [`total = plus(total, [1, 2].map(each => ${object}.${key}(each)).length);`],
        () => [`total = plus(total, ${object}.half);`],
        () => [`${object}.half = ${random.pick(["turn", "2"])};`],
        () => [`total = plus(total, ${asAny(kind())}.of(turn)${random.chance(0.5) ? "?.count" : ""});`],
        () => [
          `const made${nameCount}${any} = new ${isTyped ? `(${kind()} as any)` : kind()}(turn);`,
          `total = plus(total, made${nameCount++}.${key}(turn));`,
        ],
        () => [`if (${object}.${key} === ${random.pick(["first", "one"])}.${key}) total = plus(total, 1);`],
        () => [`total = plus(total, ${object} instanceof ${isTyped ? `(${kind()} as any)` : kind()} ? 1 : 0);`],
        () => [`text += Object.hasOwn(${object}, "${key}") ? "o" : "p";`],
        () => [`total = plus(total, ${object}?.${key}?.(turn));`],
      ])();
    };
    const body = Array.from({ length: 1 + random.below(3) }, use).flat();
    if (random.chance(0.45))
      body.splice(
        random.pick([0, body.length]),
        0,
        `if (turn === ${random.below(4)}) {`,
        ...indent(change(["one", "first"])),
        "}",
      );
    const inner = random.chance(0.5)
      ? ["for (const one of all) {", ...indent(body), "}"]
      : [`const one${any} = all[turn % all.length];`, ...body];
    const text = [
      `let total${any} = 0;`,
      'let text = "";',
      `const first${any} = all[0];`,
      random.pick(["for (let turn = 0; turn < count; turn++) {", "for (let turn = 0; turn < count; turn++) {", "for (let turn = count; turn > 0; turn--) {"]), // prettier-ignore
      ...indent(inner),
      "}",
      'return total + "|" + text.slice(0, 100);',
    ];
    const form = random.pick(["function", "function", "arrow", "async"]);
    const head = `(all${any}, count${isTyped ? ": number" : ""})`;
    if (form === "async")
      lines.push(`async function work${index}${head}${isTyped ? ": Promise<any>" : ""} {`, ...indent([...text.slice(0, 4), "  await null;", ...text.slice(4)]), "}"); // prettier-ignore
    else if (form === "arrow") lines.push(`const work${index} = ${head}${any} => {`, ...indent(text), "};");
    else lines.push(`function work${index}${head}${any} {`, ...indent(text), "}");
    calls.push(`${form === "async" ? "await " : ""}work${index}`);
  }
  const objects = Array.from({ length: 1 + random.below(3) }, (_, index) => `object${index}`);
  lines.push(
    ...objects.map(
      name => `const ${name}${any} = new ${isTyped ? `(${kind()} as any)` : kind()}(${random.pick(["", "1", "2"])});`,
    ),
  );
  const list = () => `[${Array.from({ length: 1 + random.below(4) }, () => random.pick([...objects, `new ${isTyped ? `(${kind()} as any)` : kind()}(${random.below(3)})`])).join(", ")}]`; // prettier-ignore
  const guard = (body: string[]) => ["try {", ...indent(body), "} catch (error) {", `  console.log("threw", (error${isTyped ? " as any" : ""}).name);`, "}"]; // prettier-ignore
  for (let count = 2 + random.below(4); count > 0; count--) {
    if (random.chance(0.55)) lines.push(...guard(change(objects)));
    lines.push(...guard([`console.log(${random.pick(calls)}(${list()}, ${random.pick(["1", "3", "5", "12"])}));`]));
  }
  lines.push(`console.log(steps, told.join(), ${objects.map(name => `${name}.count`).join(", ")});`);
  const ownNames = /\b(?:work\d|Kind\d|mix\d|object\d|steps|told|note|wrapped|plus|counts|sealed|starts)\b/g;
  return {
    name: `${classCount}-classes${hasDecorators ? "--decorators" : ""}`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(ownNames, name => name + suffix) : line)),
  };
}
export const writeSceneOfReplacedMethods = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeReplacedMethods(random, isTypeScript, "printValue", "_" + n).lines;
