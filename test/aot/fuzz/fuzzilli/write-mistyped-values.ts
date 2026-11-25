// Writes TypeScript programs in which a place holds a value that its declared type does not allow. For write-random-mistyped-sweep.ts and for a scene of write-ordinary-scenes.ts.
// The value enters through `any`, JSON.parse, a field that no constructor stores, a deleted property or a copy. Places are fields, variables of the file, parameters, results, elements, entries of maps and captured variables.
// Declared types are arrays, views, classes, unions, functions, maps, strings, numbers, enumerations and tuples. Each is read in nested loops by members, calls, operators, patterns and tests, in front of and behind guards, while the place changes.
// Each program prints every result.

type Kind = { name: string; type: string; right: string[]; uses: string[]; steps?: string[] };

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeMistypedValues(next: () => number, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const ofLists = [
    "X.length",
    "X.length",
    "(X as any)?.length",
    "X[0]",
    "X[X.length - 1]",
    "X.at(-1)",
    "X[7]",
    "X.slice(1).length",
    "X.join()",
    "[...X].length",
    "X.concat(X).length",
    "X.push(X[0])",
    "X.pop()",
    "X.map(one => one).length",
    "X.filter(one => one).length",
    "Array.isArray(X) ? 1 : 2",
    "X.reverse()[0]",
    "X.indexOf(X[1])",
  ];
  const stepsOfLists = [
    "for (const one of X) total = add(total, one);",
    "for (let at = 0; at < X.length; at++) total = add(total, X[at]);",
    "for (let at = X.length - 1; at >= 0; at--) total = add(total, X[at]);",
    "X.forEach(one => {\n  total = add(total, one);\n});",
    "const [first, second] = X;\ntotal = add(add(total, first), second);",
    "X[1] = X[0];",
    "X.length = 1;",
    "for (const at in X) total = add(total, at);",
  ];
  const kinds: Kind[] = [
    {
      name: "numbers",
      type: "number[]",
      right: ["[1, 2, 3]", "[0.5, 2]", "[4]", "[]", "([1, , 3] as any)", "new Array(3).fill(2)"],
      uses: [...ofLists, "X.reduce((sum, one) => sum + one, 0)", "Math.max(...X)", "X[0] + 1", "X[1] * 2", "X[0]++", "X.includes(2) ? 1 : 0"], // prettier-ignore
      steps: [...stepsOfLists, "for (const one of X) total += one;", "for (let at = 0; at < X.length; at++) total += X[at] * 2;", "for (let at = 0; at < X.length; at++) X[at] += 1;"], // prettier-ignore
    },
    {
      name: "words",
      type: "string[]",
      right: ['["a", "bc"]', '["text"]', "[]", '"x y z".split(" ")'],
      uses: [...ofLists, "X[0].length", 'X.join("")', "X[0] + X[1]", 'X.includes("a") ? 1 : 0', "X[0].charCodeAt(0)"],
      steps: [...stepsOfLists, "for (const one of X) total += one.length;", "for (let at = 0; at < X.length; at++) total += X[at].length;"], // prettier-ignore
    },
    {
      name: "items",
      type: "Item[]",
      right: ['[new Item(1, "n")]', '[new Item(2, "m"), new Wide(3, "w")]', "[]"],
      uses: [...ofLists, "X[0].size", "X[0].area()", "X[0]?.name.length", "X.reduce((sum, one) => sum + one.size, 0)"],
      steps: [...stepsOfLists, "for (const one of X) total += one.size;", "for (let at = 0; at < X.length; at++) total += X[at].area();", "for (const { size, name } of X) total += size + name.length;"], // prettier-ignore
    },
    {
      name: "item",
      type: "Item",
      right: ['new Item(1, "n")', 'new Item(0.5, "half")', 'new Wide(2, "w")', "kept"],
      uses: ["X.size", "X.name", "X.area()", "X.size + 1", "X.size * 2", "X.name.length", "X instanceof Item ? 1 : 2", "X?.size", "X === kept ? 1 : 2", '"size" in X ? 1 : 2', "({ ...X }).size", "X.size++", "X.area() + X.size", "X.list.length", "X.list[0]", "X.next?.size ?? -1", "(X as any)?.length", "typeof X.size"], // prettier-ignore
      steps: ["X.size = 5;", "X.size += 1;", "const { size, name } = X;\ntotal = add(total, size + name.length);", "for (let walk: Item | null = X, hops = 0; walk && hops < 9; walk = walk.next, hops++) total += walk.size;", "X.list.push(1);", "X.next = kept;"], // prettier-ignore
    },
    {
      name: "maybe",
      type: "Item | null",
      right: ['new Item(1, "n")', "null", 'new Wide(2, "w")', "kept"],
      uses: ["X?.size ?? -1", "X ? X.size : 0", "X === null ? 1 : X.size", "X !== null && X.size > 1 ? 1 : 0", "X!.area()", "X!.name.length", "(X as any)?.length", "X?.list.length", "X?.next?.size", "X?.area()", "!X"], // prettier-ignore
      steps: ["if (X) total += X.size;", "if (X) X.size = 3;", "for (let walk = X, hops = 0; walk && hops < 9; walk = walk.next, hops++) total += walk.size;", "if (X !== null) total = add(total, X.name);"], // prettier-ignore
    },
    {
      name: "either",
      type: "Item | Other",
      right: ['new Item(1, "n")', "new Other(4)", 'new Wide(2, "w")'],
      uses: ["X instanceof Item ? X.size : X.weight", '"size" in X ? X.size : X.weight', "X.kind", "X.kind.length", "X.area()", "(X as any).size ?? 0", "X instanceof Other ? X.weight : X.name.length", 'X.kind === "item" ? 1 : 2'], // prettier-ignore
      steps: ["if (X instanceof Item) total += X.size;\nelse total += X.weight;"],
    },
    {
      name: "run",
      type: "() => number",
      right: ["laidOne", "laidTwo", "() => 3"],
      uses: ["X()", "X() + 1", "X.call(null)", "X.length", "typeof X", "X?.()", "[1, 2].map(X).length", "X === laidOne ? 1 : 2", "(X as any)?.length", "X.name.length > 0 ? 1 : 0"], // prettier-ignore
      steps: ["for (let at = 0; at < 2; at++) total += X();"],
    },
    {
      name: "byName",
      type: "Map<string, number>",
      right: ['new Map([["a", 1]])', "new Map()", 'new Map([["a", 1], ["b", 0.5]])'],
      uses: ["X.size", 'X.get("a")', 'X.has("a") ? 1 : 2', "[...X.keys()].join()", '(X.get("b") ?? 0) + 1', "X.set(\"c\", 3).size", "X instanceof Map ? 1 : 2", "(X as any)?.length"], // prettier-ignore
      steps: ["for (const [key, one] of X) total = add(total, key + one);", "X.forEach(one => {\n  total += one;\n});", 'X.set("d", 4);', 'X.delete("a");'], // prettier-ignore
    },
    {
      name: "chosen",
      type: "Set<number>",
      right: ["new Set([1, 2])", "new Set<number>()"],
      uses: ["X.size", "X.has(1) ? 1 : 2", "[...X].length", "X.add(9).size", "(X as any)?.length"],
      steps: ["for (const one of X) total += one;", "X.delete(1);"],
    },
    {
      name: "shape",
      type: "Shape",
      right: ['{ kind: "circle", radius: 2 }', '{ kind: "square", side: 3 }'],
      uses: ['X.kind === "circle" ? X.radius : X.side', "X.kind.length", '"radius" in X ? X.radius : X.side', "({ ...X }).kind", "surface(X)"], // prettier-ignore
      steps: ['switch (X.kind) {\n  case "circle":\n    total += X.radius;\n    break;\n  case "square":\n    total += X.side * 2;\n    break;\n  default:\n    total = add(total, "none");\n}'], // prettier-ignore
    },
    {
      name: "point",
      type: "Point",
      right: ["{ x: 1, y: 2 }", "{ x: 0.5, y: -1 }", "{ y: 4, x: 3 }"],
      uses: ["X.x + X.y", "X.x", "X.y * 2", "({ ...X }).y", "X.x++", "X?.x", "Object.keys(X).join()", "(X as any)?.length", "Math.hypot(X.x, X.y) | 0"], // prettier-ignore
      steps: ["const { x, y } = X;\ntotal += x - y;", "X.x = X.y;", "X.y += 0.5;"],
    },
    {
      name: "bytes",
      type: "Uint8Array",
      right: ["new Uint8Array([1, 2, 255])", "new Uint8Array(0)", "new Uint8Array(4)"],
      uses: ["X.length", "X[0]", "X[X.length - 1]", "X[0] + 1", "X[9]", "X.byteLength", "X.subarray(1).length", "X[1]++", "X.indexOf(2)", "X.at(-1)", "(X as any)?.length"], // prettier-ignore
      steps: ["for (let at = 0; at < X.length; at++) total += X[at];", "for (const one of X) total += one;", "X[1] = 300;", "for (let at = 0; at < X.length; at++) X[at] += 250;"], // prettier-ignore
    },
    {
      name: "doubles",
      type: "Float64Array",
      right: ["new Float64Array([0.5, 2])", "new Float64Array(3)"],
      uses: ["X.length", "X[0]", "X[1] * 2", "X[9]", "X.byteLength", "X[0] += 0.25", "X.reduce((sum, one) => sum + one, 0)", "(X as any)?.length"], // prettier-ignore
      steps: [
        "for (let at = 0; at < X.length; at++) total += X[at];",
        "X[0] = 7;",
        "for (const one of X) total += one;",
      ],
    },
    {
      name: "pair",
      type: "[number, string]",
      right: ['[1, "one"]', '[0.5, "half"]'],
      uses: ["X[0] + 1", "X[1].length", "X[1] + X[0]", "X.length as number", "X.join()"],
      steps: ["const [amount, word] = X;\ntotal = add(total, amount + word.length);", "X[0] += 1;"],
    },
    {
      name: "counts",
      type: "Record<string, number>",
      right: ["{ a: 1, b: 2 }", "{}", "{ a: 0.5 }", "Object.create(null)"],
      uses: ["X.a", 'X["b"] ?? 0', "Object.keys(X).length", 'X["a"] + 1', '"a" in X ? 1 : 2', "Object.values(X).join()", "X[total] ?? 0", "(X as any)?.length"], // prettier-ignore
      steps: ["for (const key in X) total += X[key];", 'X["c"] = (X["c"] ?? 0) + 1;', "for (const [key, one] of Object.entries(X)) total = add(total, key + one);", 'delete X["a"];'], // prettier-ignore
    },
    {
      name: "size",
      type: "number",
      right: ["1", "3", "0", "0.5", "-0", "NaN", "2147483647", "-1"],
      uses: ["X + 1", "X * 2", "X | 0", "-X", "X > 2 ? 1 : 0", "X === 3 ? 1 : 0", "Math.max(X, 2)", "Math.floor(X)", "X % 3", "X >>> 1", "X ** 2", "`${X}`", "X.toFixed(1)", "(X as any)?.length", "small[X]", '"abc".charAt(X)', "X || 5", "X ?? 5", "Number.isInteger(X) ? 1 : 0", "X & 3", "typeof X", "X < total ? 1 : 0", "X == 1 ? 1 : 0", "X - 1", "X / 2", "!X", "String(X)", "~X", "X <= 1 ? 1 : 0", "X !== X ? 1 : 0"], // prettier-ignore
      steps: ["for (let at = 0; at < X && at < 40; at++) total += at;", "switch (X) {\n  case 1:\n    total += 10;\n    break;\n  case 3:\n    total += 30;\n    break;\n  default:\n    total += 1;\n}", "small[0] = X;", "total -= X;", "total = X;"], // prettier-ignore
    },
    {
      name: "name",
      type: "string",
      right: ['"text"', '"a"', '""', '"é日"', '"text" + steps'],
      uses: ["X.length", 'X + "!"', "X.charCodeAt(0)", "X[0]", "X.slice(1)", 'X === "text" ? 1 : 0', "X.toUpperCase()", 'X.indexOf("e")', 'X.split("").length', "`<${X}>`", 'X < "m" ? 1 : 0', 'X.includes("t") ? 1 : 0', "X.at(-1)", "X.padStart(5)", "[...X].length", "table[X]", "X ? 1 : 2", 'X || "none"', "X.trim().length", "X.codePointAt(0)", "(X as any)?.length", "X.concat(X)", 'X.startsWith("t") ? 1 : 0', "X.length > 2 ? X[1] : X", "typeof X", 'X.replace("t", "u")'], // prettier-ignore
      steps: ["for (const one of X) total = add(total, one);", "for (let at = 0; at < X.length; at++) total += X.charCodeAt(at);", 'switch (X) {\n  case "text":\n    total += 4;\n    break;\n  case "a":\n    total += 1;\n    break;\n  default:\n    total += 100;\n}', "total = add(total, X + X);"], // prettier-ignore
    },
    {
      name: "flag",
      type: "boolean",
      right: ["true", "false"],
      uses: ["X ? 1 : 2", "!X", "X === true ? 1 : 0", "X === false ? 1 : 0", "X && 3", "X || 4", "Number(X)", "`${X}`", "X !== false ? 1 : 2", "X ? total : 0", "typeof X"], // prettier-ignore
      steps: ["if (X) total += 1;\nelse total += 2;", "while (X) {\n  total += 5;\n  break;\n}"],
    },
    {
      name: "mode",
      type: "Mode",
      right: ["Mode.Off", "Mode.On", "Mode.Both"],
      uses: ["(X as Mode) === Mode.On ? 1 : 0", "Mode[X]", "X | Mode.Both", "X + 1", "X & Mode.On ? 1 : 2", "small[X]", "(X as any)?.length"], // prettier-ignore
      steps: ["switch (X as Mode) {\n  case Mode.Off:\n    total += 1;\n    break;\n  case Mode.On:\n    total += 2;\n    break;\n  case Mode.Both:\n    total += 3;\n    break;\n}"], // prettier-ignore
    },
    {
      name: "side",
      type: '"left" | "right"',
      right: ['"left"', '"right"'],
      uses: ['(X as "left" | "right") === "left" ? 1 : 2', "({ left: 1, right: 2 })[X]", "X.length", "X + X", "X[0]"],
      steps: ['switch (X as "left" | "right") {\n  case "left":\n    total += 1;\n    break;\n  case "right":\n    total += 2;\n    break;\n  default:\n    total = add(total, "neither");\n}'], // prettier-ignore
    },
    {
      name: "either1",
      type: "number | string",
      right: ["1", '"text"', "0.5", '""'],
      uses: ['typeof X === "number" ? X + 1 : X.length', 'typeof X === "string" ? X.toUpperCase() : X * 2', "`${X}`", "X === 1 ? 1 : 2", "(X as any)?.length", "X || 3"], // prettier-ignore
      steps: ['if (typeof X === "number") total += X;\nelse total += X.length;'],
    },
    {
      name: "large",
      type: "bigint",
      right: ["1n", "0n", "2n ** 70n"],
      uses: ["X + 1n", "X * 2n", "String(X)", "X > 1n ? 1 : 0", "Number(X)", "X === 0n ? 1 : 2", "-X", "X ? 1 : 2"],
    },
    {
      name: "day",
      type: "Date",
      right: ["new Date(0)", "new Date(86400000)"],
      uses: ["X.getTime()", "X instanceof Date ? 1 : 2", "+X", "X.toISOString().length", "(X as any)?.length"],
    },
    {
      name: "word",
      type: "string | undefined",
      right: ['"text"', "undefined", '""'],
      uses: [
        "X?.length ?? -1",
        "X!.length",
        'X === undefined ? 0 : X + "!"',
        'X ?? "none"',
        "X?.[0]",
        "X ? X.length : 0",
      ],
      steps: ["if (X !== undefined) total += X.length;", "if (X) total = add(total, X.toUpperCase());"],
    },
  ];
  const anyValue = () =>
    random.pick([
      "null",
      "undefined",
      "undefined",
      "1",
      "3",
      "0.5",
      "NaN",
      "-0",
      '"text"',
      '"2"',
      '""',
      "true",
      "false",
      "[]",
      "[1, 2]",
      '["a", 1, null]',
      "[[1], [2]]",
      "[1, , 3]",
      "{}",
      "{ x: 1 }",
      '{ x: "1", y: 2 }',
      "{ length: 2, 0: 5 }",
      '{ kind: "circle", radius: "2" }',
      '{ kind: "other", side: 1 }',
      '{ size: 4, name: "lit" }',
      "{ size: 4, area: named }",
      "{ get size() { return ++steps; } }",
      'Object.defineProperty({}, "valueOf", { value: () => 6 })',
      "laidOne",
      "named",
      "() => 1",
      'new Item(7, "wrong")',
      'new Wide(8, "wider")',
      "new Other(2)",
      "new Item(null, undefined)",
      'new Item("5", 6)',
      "Object.create(Item.prototype)",
      "Object.create(null)",
      "5n",
      'new Map([["a", "1"]])',
      "new Set([1])",
      "new Uint8Array([4, 5, 6])",
      "new Float64Array([1.5, 2])",
      "new Int32Array(2)",
      "new Date(5)",
      "/x/",
      "new Proxy([1, 2], {})",
      'new Proxy({ size: 1 }, { get: (_, key) => (key === "size" ? ++steps : undefined) })',
      'new String("abc")',
      "new Number(3)",
      "Symbol.iterator",
      'JSON.parse("[1,2,\\"3\\"]")',
      'JSON.parse("{\\"size\\":1,\\"length\\":3}")',
      "Object.freeze([1, 2, 3])",
      "new (class extends Array {})(3).fill(1)",
      "(function* () { yield 1; yield 2; })()",
      "Math",
      "JSON",
      "globalThis",
      'Buffer.from("ab")',
      'new URL("http://a/b")',
      'new Error("wrong")',
      "Promise.resolve(1)",
      "new WeakMap()",
      "new (class extends Map {})()",
      "Object.assign([1, 2], { size: 3, name: 4 })",
      ...(suffix ? [] : ["path", "path.posix", "{ ...path }", "util.types"]),
    ]);
  const fieldCount = 1 + random.below(4);
  const fields: Kind[] = [];
  while (fields.length < fieldCount) {
    const kind = random.pick(kinds);
    if (!fields.includes(kind)) fields.push(kind);
  }
  const lines: string[] = [
    ...(suffix ? [] : ['import path from "node:path";', 'import util from "node:util";']),
    "let steps = 0;",
    "const small: number[] = [10, 20, 30];",
    "const table: Record<string, number> = { text: 1, a: 2 };",
    "interface Point {\n  x: number;\n  y: number;\n}",
    'type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };',
    `${random.chance(0.3) ? "const " : ""}enum Mode {\n  Off,\n  On,\n  Both = 4,\n}`.replace(/^const enum/, "enum"),
    ...[
      "class Item {",
      '  kind = "item";',
      random.chance(0.7) ? "  size: number;" : "  size: number = 0;",
      "  name: string;",
      "  list: number[] = [1];",
      "  next: Item | null = null;",
      "  constructor(size: any, name: any) {",
      "    this.size = size;",
      "    this.name = name;",
      "  }",
      "  area(): number {",
      random.pick([
        "    return this.size * 2;",
        "    return this.size + this.name.length;",
        "    return this.list.length + this.size;",
      ]),
      "  }",
      "}",
      "class Wide extends Item {",
      "  wide: number = 1;",
      random.chance(0.5) ? "  area(): number {\n    return super.area() + this.wide;\n  }" : "",
      "}",
      "class Other {",
      '  kind = "other";',
      "  weight: number;",
      "  constructor(weight: any) {",
      "    this.weight = weight;",
      "  }",
      "  area(): number {",
      "    return this.weight;",
      "  }",
      "}",
    ].filter(Boolean),
    'const kept = new Item(6, "kept");',
    "function laidOne() {\n  return 1;\n}",
    "function laidTwo() {\n  return ++steps;\n}",
    'const named: any = Object.assign(() => 4, { size: 5, toString: () => "named" });',
    'function surface(shape: Shape): number {\n  return shape.kind === "circle" ? shape.radius * 2 : shape.side;\n}',
    'function plain(value: any): any {\n  return typeof value === "function" ? "function" : typeof value === "symbol" ? "symbol" : typeof value === "object" && value !== null ? "object" : value;\n}', // prettier-ignore
    "function add(total: any, value: any): any {\n  return plain(total) + plain(value);\n}",
    'function show(value: any): string {\n  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(plain(value)).slice(0, 300);\n}', // prettier-ignore
  ];
  lines.push(
    "function told(error: any): string {",
    '  return error?.name + " " + String(error?.message).replace(/ \\(.*/s, "").replace(/^(?!undefined |null ).* is not/s, "is not");', // prettier-ignore
    "}",
  );
  const isLied = random.chance(0.9);
  const value = (kind: Kind) =>
    isLied && random.chance(0.4) ? `((${anyValue()}) as any)` : `${random.pick(kind.right)}`;
  // The holder.
  const holderForm = random.pick([
    "class",
    "class",
    "class",
    "fields",
    "literal",
    "parsed",
    "static",
    "derived",
    "box",
  ]);
  const field = (kind: Kind) => kind.name;
  const parameters = fields.map(kind => `${field(kind)}: any`).join(", ");
  if (holderForm === "class" || holderForm === "derived") {
    const stored = fields.filter(() => random.chance(0.85));
    lines.push(
      "class Holder {",
      ...fields.map(kind => `  ${random.chance(0.15) ? "readonly " : ""}${field(kind)}${stored.includes(kind) ? ":" : "!:"} ${kind.type};`.replace("readonly ", "")), // prettier-ignore
      `  constructor(${parameters}) {`,
      ...stored.map(kind => `    this.${field(kind)} = ${field(kind)};`),
      "  }",
      ...fields.filter(() => random.chance(0.4)).map(kind => `  get${kind.name}(): ${kind.type} {\n    return this.${field(kind)};\n  }`), // prettier-ignore
      "}",
    );
    if (holderForm === "derived") lines.push("class Derived extends Holder {", "  extra = 1;", "}");
  } else if (holderForm === "fields")
    lines.push(
      "class Holder {",
      ...fields.map(kind => `  ${field(kind)}: ${kind.type} = ${random.pick(kind.right)};`),
      "}",
    );
  else if (holderForm === "box")
    lines.push(
      "class Box<V> {",
      "  constructor(public value: V) {}",
      "}",
      `interface Holder {\n${fields.map(kind => `  ${field(kind)}: ${kind.type};`).join("\n")}\n}`,
    );
  else
    lines.push(
      `interface Holder {\n${fields.map(kind => `  ${field(kind)}: ${kind.type};`).join("\n")}\n}`,
      ...(holderForm === "static" ? ["class Global {", ...fields.map(kind => `  static ${field(kind)}: ${kind.type} = ${random.pick(kind.right)};`), "}"] : []), // prettier-ignore
    );
  lines.push(...fields.map(kind => `let shared${kind.name}: ${kind.type} = ${random.pick(kind.right)};`));
  const literalOf = (values: string[]) => `{ ${fields.map((kind, index) => `${field(kind)}: ${values[index]}`).join(", ")} }`; // prettier-ignore
  const makeHolder = () => {
    const values = fields.map(kind => value(kind));
    if (holderForm === "class") return `new Holder(${values.join(", ")})`;
    if (holderForm === "derived") return `new ${random.pick(["Holder", "Derived"])}(${values.join(", ")})`;
    if (holderForm === "fields") return random.chance(0.4) ? "new Holder()" : `Object.assign(new Holder(), ${literalOf(values)})`; // prettier-ignore
    if (holderForm === "static") return random.chance(0.5) ? "Global" : `Object.assign(Global, ${literalOf(values)})`;
    if (holderForm === "parsed") return `JSON.parse(${JSON.stringify(random.pick(['{"size":1,"name":"parsed","numbers":[1,2],"words":["a"],"flag":true}', '{"size":"1","name":2,"numbers":["1"],"words":[1],"point":{"x":"1"}}', "{}", '{"numbers":{"length":2},"shape":{"kind":"circle"},"counts":{"a":"1"}}', "[]"]))})`; // prettier-ignore
    if (holderForm === "box") return `new Box<Holder>(${literalOf(values)} as any).value`;
    return literalOf(values);
  };
  const storedElsewhere = (target: string) => {
    const kind = random.pick(fields);
    const changed = `((${anyValue()}) as any)`;
    return random.pick([
      `${target}.${field(kind)} = ${changed};`,
      `${target}.${field(kind)} = ${changed};`,
      `(${target} as any)["${field(kind)}"] = ${changed};`,
      `Object.assign(${target}, { ${field(kind)}: ${changed} });`,
      `Reflect.set(${target}, "${field(kind)}", ${changed});`,
      `delete (${target} as any).${field(kind)};`,
      `Object.defineProperty(${target}, "${field(kind)}", { get: () => ${changed}, configurable: true });`,
      `shared${kind.name} = ${changed};`,
      `${target}.${field(kind)} = (${random.pick(kind.right)}) as any;`,
    ]);
  };
  if (random.chance(0.5))
    lines.push(
      "function change(holder: Holder, turn: number): void {",
      `  if (turn === ${random.below(4)}) ${storedElsewhere("holder")}`,
      "}",
    );
  const hasChange = lines.at(-3)?.startsWith("function change") ?? false;
  for (const kind of fields.filter(() => random.chance(0.4)))
    lines.push(
      `function give${kind.name}(turn: number): ${kind.type} {`,
      `  return turn === ${random.below(4)} ? ((${anyValue()}) as any) : ${random.pick(kind.right)};`,
      "}",
    );
  const givers = new Set(lines.flatMap(line => /^function give(\w+)\(/.exec(line)?.[1] ?? []));
  // The readers.
  const readerCount = 1 + random.below(3);
  let nameCount = 0;
  const calls: string[] = [];
  for (let index = 0; index < readerCount; index++) {
    const depth = random.pick([0, 1, 1, 1, 2, 2]);
    const before: string[] = [];
    const place = (): { text: string; kind: Kind } => {
      const kind = random.pick(fields);
      const direct = `holder.${field(kind)}`;
      switch (random.below(14)) {
        case 0: {
          const name = `local${nameCount++}`;
          before.push(`${random.pick(["const", "let"])} ${name}: ${kind.type} = ${direct};`);
          return { text: name, kind };
        }
        case 1:
          return { text: `shared${kind.name}`, kind };
        case 2: {
          const name = `same${nameCount++}`;
          before.push(`const ${name}: Holder = holder;`);
          return { text: `${name}.${field(kind)}`, kind };
        }
        case 3: {
          const name = `list${nameCount++}`;
          before.push(`const ${name}: ${kind.type.includes("|") || kind.type.includes(">") ? `(${kind.type})` : kind.type}[] = [${direct}, ${random.pick(kind.right)}, ${value(kind)}];`); // prettier-ignore
          return { text: `${name}[${depth === 0 ? random.below(3) : "turn % 3"}]`, kind };
        }
        case 4:
          if (givers.has(kind.name)) return { text: `give${kind.name}(${depth === 0 ? "1" : "turn"})`, kind };
          return { text: direct, kind };
        case 5: {
          const name = `map${nameCount++}`;
          before.push(`const ${name} = new Map<string, ${kind.type}>([["a", ${direct}]]);`);
          return { text: `${name}.get("a")!`, kind };
        }
        case 6: {
          const name = `get${nameCount++}`;
          before.push(`const ${name} = (): ${kind.type} => ${direct};`);
          return { text: `${name}()`, kind };
        }
        case 7: {
          const name = `box${nameCount++}`;
          before.push(`const ${name}: { value: ${kind.type} } = { value: ${direct} };`);
          return { text: `${name}.value`, kind };
        }
        default:
          return { text: direct, kind };
      }
    };
    const use = (): string[] => {
      const { text: read, kind } = place();
      const isNarrowed = kind.type.includes("|") || kind.name === "shape";
      const binding = isNarrowed && /[)!\]]$/.test(read) ? `const bound${nameCount}: ${kind.type} = ${read};` : "";
      const text = binding ? `bound${nameCount++}` : read;
      const of = (from: string) => from.replace(/\bX\b/g, () => text);
      const isAssignable = !/\)$|!$/.test(text) && !text.startsWith("local") && !binding;
      let result: string[];
      if (kind.steps && random.chance(0.35)) {
        const step = random.pick(kind.steps);
        result = [/^const /.test(step) ? `{\n${indent([of(step)]).join("\n")}\n}` : of(step)];
      } else {
        let chosen = random.pick(kind.uses);
        if (!isAssignable) chosen = chosen.replace(/\bX\+\+/, "X");
        result = [
          random.pick([
            `total = add(total, ${of(chosen)});`,
            `total = add(total, ${of(chosen)});`,
            `total += (${of(chosen)}) as any;`,
            `if (${of(chosen)}) total = add(total, 1);`,
            `const kept${nameCount} = ${of(chosen)};\ntotal = add(total, kept${nameCount++});`,
            `${depth === 0 ? "" : "if (turn > 0) "}total = add(${of(chosen)}, total);`,
          ]),
        ];
      }
      if (random.chance(0.15))
        result = [
          random
            .pick([
              `if (${text} as any) {`,
              `if (${text} !== undefined) {`,
              `if ((${text} as any)?.length !== 0) {`,
              `if (typeof ${text} === "${random.pick(["object", "number", "string"])}") {`,
              `if (Array.isArray(${text} as any)) {`,
              `if ((${text} as any) instanceof Item) {`,
            ])
            .replace(/typeof (\S+?) ===/, "typeof ($1 as any) ==="),
          ...indent(result),
          "}",
        ];
      else if (random.chance(0.08))
        result = ["try {", ...indent(result), "} catch (error) {", '  total = add(total, (error as any).name);', "}"]; // prettier-ignore
      else if (random.chance(0.06)) result = [`[0, 1].forEach(() => {`, ...indent(result), "});"];
      if (binding) result = ["{", ...indent([binding, ...result]), "}"];
      return [result.join("\n")];
    };
    const statements = () => {
      const body = Array.from({ length: 1 + random.below(3) }, use).flat();
      if (hasChange && random.chance(0.4)) body.splice(random.below(body.length + 1), 0, depth === 0 ? "change(holder, 1);" : "change(holder, turn);"); // prettier-ignore
      else if (random.chance(0.2)) body.splice(random.chance(0.5) ? 0 : body.length, 0, depth === 0 ? storedElsewhere("holder") : `if (turn === ${random.below(4)}) ${storedElsewhere("holder")}`); // prettier-ignore
      return body;
    };
    let body = statements();
    if (depth === 2) {
      body = ["for (let inner = 0; inner < 3; inner++) {", ...indent(body), "}"];
      if (random.chance(0.4)) body = [...use(), ...body];
    }
    if (depth > 0)
      body = [
        random.pick([
          "for (let turn = 0; turn < count; turn++) {",
          "for (let turn = 0; turn < count; turn++) {",
          "for (let turn = count; turn > 0; turn--) {",
          "for (const turn of [0, 1, 2, 3]) {",
        ]),
        ...indent(body),
        "}",
      ];
    if (random.chance(0.3)) body = [...use().map(line => line.replace(/\bturn\b/g, "count")), ...body];
    if (random.chance(0.3)) body.push(...use().map(line => line.replace(/\bturn\b/g, "count")));
    const form = random.pick(["function", "function", "function", "arrow", "generator", "async", "method"]);
    const text = [...before, ...body];
    if (form === "generator")
      lines.push(
        `function* read${index}(holder: Holder, count: number): Generator<any> {`,
        "  let total: any = 0;",
        ...indent(text.map(line => line.replace(/^( *)(for \(let turn .*\{)$/, "$1$2\n$1  yield total;"))),
        "  yield total;",
        "}",
      );
    else if (form === "async")
      lines.push(
        `async function read${index}(holder: Holder, count: number): Promise<any> {`,
        "  let total: any = 0;",
        ...(random.chance(0.5) ? ["  await null;"] : []),
        ...indent(text.map(line => line.replace(/^( *)(for \(let turn .*\{)$/, "$1$2\n$1  await null;"))),
        "  return total;",
        "}",
      );
    else if (form === "arrow")
      lines.push(
        `const read${index} = (holder: Holder, count: number): any => {`,
        "  let total: any = 0;",
        ...indent(text),
        "  return total;",
        "};",
      );
    else if (form === "method")
      lines.push(
        `class Reader${index} {`,
        `  static read(holder: Holder, count: number): any {`,
        "    let total: any = 0;",
        ...indent(indent(text)),
        "    return total;",
        "  }",
        "}",
      );
    else
      lines.push(
        `function read${index}(holder: Holder, count: number): any {`,
        "  let total: any = 0;",
        ...indent(text),
        "  return total;",
        "}",
      );
    const count = random.pick(["1", "3", "4", "6", "20"]);
    calls.push(
      form === "generator"
        ? `[...read${index}(holder, ${count})].join()`
        : form === "async"
          ? `await read${index}(holder, ${count})`
          : form === "method"
            ? `Reader${index}.read(holder, ${count})`
            : `read${index}(holder, ${count})`,
    );
  }
  const holderCount = 1 + random.below(4);
  lines.push(`const holders: any[] = [${Array.from({ length: holderCount }, () => `() => (${makeHolder()})`).join(", ")}];`); // prettier-ignore
  const guarded = (call: string) => [
    "  try {",
    `    console.log(show(${call}));`,
    "  } catch (error) {",
    '    console.log("threw", told(error));',
    "  }",
  ];
  lines.push(
    "for (const make of holders) {",
    "  let holder: any;",
    "  try {",
    "    holder = make();",
    "  } catch (error) {",
    '    console.log("made", (error as any)?.name);',
    "    continue;",
    "  }",
    ...calls.flatMap(call => Array.from({ length: random.chance(0.4) ? 2 : 1 }, () => guarded(call)).flat()),
    "}",
    ...["try {", "  console.log(steps, show(kept.size), small.join());", "} catch (error) {", '  console.log("threw", told(error));', "}"], // prettier-ignore
  );
  const ownNames =
    /(?<!(?:^|[^.])\.)(?<!["\w])(?:steps|small|table|Point|Shape|Mode|Item|Wide|Other|kept|laidOne|laidTwo|named|surface|plain|add|show|told|Holder|Derived|Global|Box|holders|change|read\d|Reader\d|(?:shared|give)[a-z]\w*)(?!["\w])/g;
  return {
    name: `${holderForm}--${fields.map(kind => kind.name).join("-")}`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(ownNames, name => name + suffix) : line)),
  };
}
export const writeSceneOfMistypedValues = (random: () => number, n: number): string[] =>
  writeMistypedValues(random, "printValue", "_" + n).lines;
