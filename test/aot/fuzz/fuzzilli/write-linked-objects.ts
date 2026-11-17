// Writes programs that walk linked objects: lists, rings, trees and lists of lists, made of classes or of literals. For write-random-linked-sweep.ts and for a scene of write-ordinary-scenes.ts.
// A loop around the walk, the walk itself or a function that it calls changes one object: it deletes a field, defines it anew, adds one, replaces the prototype, freezes it, gives a field another kind of value or links it elsewhere.
// Each program prints what every walk reads, and all objects at its end.

const changes = [
  "nothing",
  "delete",
  "delete",
  "define-getter",
  "define-value",
  "add",
  "prototype",
  "freeze",
  "another-kind",
  "relink",
  "undefined",
] as const;

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeLinkedObjects(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const any = isTyped ? ": any" : "";
  // Most of the TypeScript programs say what the fields and the links are.
  const isPrecise = isTyped && random.chance(0.75);
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const fields = ["value", "weight", "label"].slice(0, 1 + random.below(3));
  const link = random.pick(["next", "next", "parent", "left"]);
  const hasSecondLink = random.chance(0.3);
  const links = hasSecondLink ? [link, "right"] : [link];
  const kind = isPrecise
    ? "class"
    : random.pick(["class", "class", "literal", "two-classes", "subclass", "json"] as const);
  const isRing = random.chance(0.15);
  const length = 2 + random.below(4);
  // Each value with its type.
  const choices: [string, string][] = [
    ["index % 2 === 0", "boolean"],
    ["index > 1", "boolean"],
    ["index", "number"],
    ["index + 0.5", "number"],
    ["1", "number"],
    ["String(index)", "string"],
    ['"l" + index', "string"],
    ...((isPrecise
      ? []
      : [
          ["undefined", "any"],
          ["[index]", "any"],
          ["null", "any"],
        ]) as [string, string][]),
  ];
  const chosen = fields.map(() => random.pick(choices));
  const values = Object.fromEntries(fields.map((field, at) => [field, chosen[at][0]]));
  const typeOf = (field: string) => (isPrecise ? ": " + chosen[fields.indexOf(field)][1] : any);
  const node = isPrecise ? ": Node0 | null" : any;
  const certain = isPrecise ? ": Node0" : any;
  const loose = (object: string) => (isPrecise ? `(${object} as any)` : object);
  const lines: string[] = [];
  const classText = (name: string, own: string[], base?: string) => [
    `class ${name}${base ? " extends " + base : ""} {`,
    ...(isTyped
      ? [...(base ? [] : links.map(each => `  ${each}${node};`)), ...own.map(field => `  ${field}${typeOf(field)};`)]
      : []),
    `  constructor(index${isPrecise ? ": number" : any}) {`,
    ...(base ? ["    super(index);"] : []),
    ...own.map(field => `    this.${field} = ${values[field]};`),
    ...(base ? [] : links.map(each => `    this.${each} = null;`)),
    "  }",
    ...(random.chance(0.2) ? [`  get total()${any} {`, `    return this.${own[0] ?? fields[0]};`, "  }"] : []),
    "}",
  ];
  if (kind === "class" || kind === "two-classes" || kind === "subclass") lines.push(...classText("Node0", fields));
  if (kind === "two-classes")
    lines.push(...classText("Node1", random.chance(0.5) ? [...fields].reverse() : fields.slice(0, 1)));
  if (kind === "subclass")
    lines.push(
      ...classText(
        "Node1",
        ["extra"].filter(() => random.chance(0.5)),
        "Node0",
      ).map(line => line.replace("this.extra = undefined", "this.extra = index")),
    );
  const literal = `{ ${[...fields.map(field => `${field}: ${values[field]}`), ...links.map(each => `${each}: null`)].join(", ")} }`;
  lines.push(
    `function create(index${isPrecise ? ": number" : any})${certain} {`,
    kind === "literal"
      ? `  return ${literal};`
      : kind === "json"
        ? `  return JSON.parse(JSON.stringify(${literal}));`
        : kind === "class"
          ? "  return new Node0(index);"
          : "  return index % 2 ? new Node1(index) : new Node0(index);",
    "}",
    `function createList(count${isPrecise ? ": number" : any})${node} {`,
    `  let head${node} = null;`,
    `  const made${isTyped ? ": any[]" : ""} = [];`,
    "  for (let index = count - 1; index >= 0; index--) {",
    `    const node${certain} = create(index);`,
    `    node.${link} = head;`,
    ...(hasSecondLink ? [`    node.right = ${random.pick(["made[0] ?? null", "head", "null"])};`] : []),
    "    head = node;",
    "    made.push(node);",
    "  }",
    ...(isRing ? [`  if (made.length) made[0].${link} = head;`] : []),
    "  return head;",
    "}",
  );
  const field = () => random.pick(fields);
  /** A change of one object, as statements. */
  const changeOf = (changed: string): string => {
    const object = loose(changed);
    const name = field();
    switch (random.pick(changes)) {
      case "delete":
        return `delete ${object}.${random.chance(0.85) ? name : link};`;
      case "define-getter":
        return `Object.defineProperty(${object}, "${name}", { get: () => ${random.pick(["100", '"got"', "steps"])}, enumerable: true, configurable: true });`;
      case "define-value":
        return `Object.defineProperty(${object}, "${name}", { value: 50, writable: ${random.chance(0.5)}, enumerable: ${random.chance(0.7)}, configurable: true });`;
      case "add":
        return `${object}.added = ${random.pick(["1", '"a"', "steps"])};`;
      case "prototype":
        return `Object.setPrototypeOf(${object}, ${random.pick(["null", `{ ${name}: 7 }`, "{ added: 7 }"])});`;
      case "freeze":
        return `Object.${random.pick(["freeze", "seal", "preventExtensions"])}(${object});`;
      case "another-kind":
        return `${object}.${name} = ${random.pick(['"kind"', "0.75", "null", "[2]", "-1", "true"])};`;
      case "relink":
        return `${object}.${link} = ${random.pick(["null", `${object}.${link}?.${link} ?? null`, "create(9)"])};`;
      case "undefined":
        return `${object}.${name} = undefined;`;
      default:
        return "steps++;";
    }
  };
  const read = (object: string) => {
    const text = `${object}.${field()}`;
    return random.pick([
      `if (${text}) sum++;`,
      `if (${text}) sum++;`,
      `if (${text} === undefined) sum += 100;`,
      `out += ${text} + ",";`,
      `sum += Number(${text}) || 0;`,
      `sum += ${loose(text)} | 0;`,
      `if (${loose(text)} === ${random.pick(["1", "2", "undefined", '"kind"'])}) sum += 1000;`,
      `out += typeof ${text};`,
      `out += ${loose(object)}.total ?? "";`,
      `${loose(object)}.${fields[0]} = ${random.pick(["sum", "steps", '"set"'])};`,
      `if ("${field()}" in ${object}) sum += 5;`,
    ]);
  };
  const condition = random.pick(["node", "node", "node !== null", "node != null", "node"]);
  const walk = (head: string): string[] => {
    // Most walks only read.
    const isQuiet = !isRing && random.chance(0.55);
    const body = [
      ...(isQuiet ? [] : ["steps++;"]),
      ...Array.from({ length: 1 + random.below(3) }, () => read("node")),
      ...(!isQuiet && random.chance(0.35) ? [`if (steps === ${1 + random.below(6)}) ${changeOf("node")}`] : []),
      ...(random.chance(0.15) ? [`if (${random.pick(["sum > 40", `${loose(`node.${field()}`)} === 2`])}) break;`] : []),
      ...(!isQuiet && random.chance(0.3) ? ["touch(node);"] : []),
    ];
    const advance = `node = node.${link}`;
    return random.chance(0.6)
      ? [
          `for (let node${node} = ${head}; ${isRing ? condition + " && steps < 60" : condition}; ${advance}) {`,
          ...indent(body),
          "}",
        ]
      : [
          `let node${node} = ${head};`,
          `while (${isRing ? condition + " && steps < 60" : condition}) {`,
          ...indent([...body, advance + ";"]),
          "}",
        ];
  };
  lines.push(
    "let steps = 0;",
    `function touch(node${certain}) {`,
    ...indent([random.chance(0.5) ? `if (steps === ${1 + random.below(8)}) ${changeOf("node")}` : "steps += 0;"]),
    "}",
  );
  const walkerCount = 1 + random.below(3);
  for (let index = 0; index < walkerCount; index++) {
    // The change stands in the loop around the walk, behind the walk or before it.
    const rounds = random.pick(["2", "3", "3", "4"]);
    const target = random.pick(["head", "head", "head", `head?.${link} ?? head`, "other"]);
    const change = `{ const target${node} = ${target}; if (target) ${changeOf("target")} }`;
    const guard = random.pick([`if (round === ${random.below(3)}) `, "", `if (sum > ${random.below(20)}) `]);
    const inner = walk("head");
    const isBefore = random.chance(0.5);
    lines.push(
      `function walk${index}(head${node}, other${node})${any} {`,
      ...indent([
        `let out${any} = "";`,
        `let sum${any} = 0;`,
        ...(random.chance(0.75)
          ? [
              `for (let round = 0; round < ${rounds}; round++) {`,
              ...indent([
                ...(isBefore ? [guard + change] : []),
                "steps = 0;",
                "{",
                ...indent(inner),
                "}",
                ...(isBefore ? [] : [guard + change]),
              ]),
              "}",
            ]
          : [
              `let round${isTyped ? ": number" : ""} = 1;`,
              ...(isBefore ? [guard + change] : []),
              "{",
              ...indent(inner),
              "}",
              ...(isBefore ? [] : [guard + change]),
            ]),
        'return out + " " + sum;',
      ]),
      "}",
    );
  }
  lines.push(
    `const hide = (value${any})${any} => ${random.chance(0.5) ? 'JSON.parse("0", () => value)' : "value"};`,
    `const lists${isTyped ? ": any[]" : ""} = [hide(createList(${length})), createList(${1 + random.below(4)})${random.chance(0.3) ? ", createList(0)" : ""}];`,
    ...(random.chance(0.3) ? [`try {\n  ${changeOf("lists[0]")}\n} catch {}`] : []),
    "for (let call = 0; call < lists.length; call++) {",
    ...Array.from({ length: walkerCount }, (_, index) =>
      [
        "  try {",
        `    console.log(walk${index}(lists[call], lists[${random.pick(["0", "1", "call"])}]));`,
        "  } catch (error) {",
        `    console.log("threw", (error${isTyped ? " as any" : ""}).name);`,
        "  }",
      ].join("\n"),
    ),
    "}",
    `function show(head${any})${any} {`,
    `  const seen${isTyped ? ": any[]" : ""} = [];`,
    `  for (let node${any} = head; node && seen.length < 12; node = node.${link}) seen.push(Reflect.ownKeys(node).map(key => ${JSON.stringify(links)}.includes(String(key)) ? key : String(key) + "=" + node[key]).join(" "));`,
    '  return seen.join(" > ");',
    "}",
    "for (const list of lists) console.log(show(list));",
  );
  const ownNames = /\b(?:(?:Node|walk)\d|create|createList|steps|touch|lists|show|hide)\b/g;
  return {
    name: `${kind}--${fields.length}-fields--${walkerCount}-walks${isRing ? "--ring" : ""}`,
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "(").replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfLinkedObjects = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeLinkedObjects(random, isTypeScript, "printValue", "_" + n).lines;
