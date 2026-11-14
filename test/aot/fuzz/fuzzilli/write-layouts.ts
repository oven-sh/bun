// Writes programs that read fields of a value of several classes, records and primitives, more than once and behind tests of what it is. For write-random-layout-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Some objects lose a field, get another, have one defined anew, are frozen or have another prototype, before the reads or between them.
// The tests are typeof, instanceof, in, Array.isArray, a comparison with undefined or null, a discriminant and optional chaining. The callers walk a list by index, by for-of or by forEach, or call once for each object.
// Each program prints every result.

const callers = [
  "indexed-loop",
  "indexed-loop",
  "while-loop",
  "direct-calls",
  "direct-calls",
  "for-of",
  "for-each",
  "method",
  "generator",
  "nested-loop",
] as const;
const changes = [
  "nothing",
  "delete",
  "add",
  "define-value",
  "define-getter",
  "freeze",
  "prototype",
  "null-prototype",
  "another-type",
  "assign",
  "delete-and-add",
] as const;
type Change = (typeof changes)[number];
const fieldNames = ["size", "lid", "weight", "volume", "label"] as const;

const ownNames =
  /\b(?:(?:createKind|Kind|describe|Reader|reader|changed)\d|all|calls|index|results|early|handedOut)\b/g;

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeLayouts(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const type = (text: string) => (isTyped ? text : "");
  const classCount = random.chance(0.2) ? 2 : 3 + random.below(2);
  const caller = random.pick(callers);
  const mainChange = random.chance(0.3) ? "delete" : random.pick(changes);

  // The kinds of objects: classes, some with a base class or an accessor, and functions that return records.
  type Layout = { name: string; fields: string[]; isRecord: boolean; hasKind: boolean };
  const hasKind = random.chance(0.25);
  const layouts: Layout[] = [];
  const definitions: string[] = [];
  // Each value with its type.
  const values = [
    ["value", "number"],
    ["value", "number"],
    ["value * 2", "number"],
    ["value + 0.5", "number"],
    ["1", "number"],
    ['"text"', "string"],
    ["String(value)", "string"],
    ["[value]", "number[]"],
    ["{ inner: value }", "any"],
    ["undefined", "any"],
  ] as const;
  const hasMethodField = random.chance(0.25);
  // A constructor may hand the object to a reader before it has all its fields.
  let handsOutEarly = false;
  const storesOf = (stores: { field: string; value: string }[], share: number): string => {
    const lines = stores.map(({ field, value }) => `    this.${field} = ${value};\n`);
    if (random.chance(share)) {
      handsOutEarly = true;
      lines.splice(random.below(lines.length + 1), 0, "    early(this);\n");
    }
    return lines.join("");
  };
  for (let index = 0; index < classCount; index++) {
    const name = "Kind" + index;
    const isRecord = random.chance(0.1);
    // Most layouts have no field of another.
    const layoutNames = random.chance(0.7) ? ["own" + index, "more" + index] : fieldNames;
    const fields: string[] = [
      ...new Set(
        Array.from({ length: 1 + random.below(3) }, () => random.pick<string>(index === 0 ? fieldNames : layoutNames)),
      ),
    ];
    // Most first classes have the two fields that the reads and the changes below ask for.
    if (index === 0 && !fields.includes("size")) fields.unshift("size");
    if (index === 0 && fields.length < 2) fields.push("lid");
    const stores = fields.map(field => {
      const [value, typeOfValue] = random.pick(values);
      return { field, value: value as string, type: random.chance(0.3) ? "any" : typeOfValue };
    });
    if (index === 0 && hasMethodField) stores.splice(1, 0, { field: "run", value: "() => value", type: "any" });
    const kindField = hasKind ? [{ field: "kind", value: `"${name}"`, type: "string" }] : [];
    if (isRecord) {
      definitions.push(
        `function create${name}(value${type(": number")})${type(": any")} {`,
        `  return { ${[...kindField, ...stores].map(({ field, value }) => `${field}: ${value}`).join(", ")} };`,
        "}",
      );
    } else if (!isTyped && random.chance(0.35)) {
      definitions.push(`function ${name}(value) {`, storesOf([...kindField, ...stores], 0.4), "}");
    } else {
      const base = random.chance(0.1)
        ? layouts.find(layout => !layout.isRecord && !layout.fields.some(field => fields.includes(field)))
        : undefined;
      const hasInitializers = random.chance(0.3);
      const declared = type([...kindField, ...stores].map(({ field, type }) => `  ${field}: ${type};\n`).join(""));
      definitions.push(
        `class ${name}${base ? ` extends ${base.name}` : ""} {`,
        hasInitializers
          ? [...kindField, ...stores]
              .map(
                ({ field, value, type: typeOfField }) =>
                  `  ${field}${type(": " + typeOfField)} = ${value.replaceAll("value", "2")};\n`,
              )
              .join("") +
              `  constructor(value${type(": number")}) {\n${base ? "    super(value);\n" : ""}    this.${stores[0].field} = ${stores[0].value};\n  }`
          : declared +
              `  constructor(value${type(": number")}) {\n${base ? "    super(value);\n" : ""}${storesOf([...kindField, ...stores], 0.1)}  }`,
        ...(random.chance(0.15) ? [`  get volume2()${type(": any")} {\n    return this.${stores[0].field};\n  }`] : []),
        "}",
      );
      if (base) fields.push(...base.fields);
    }
    layouts.push({ name, fields, isRecord, hasKind });
  }
  const create = (layout: Layout, value: number) =>
    layout.isRecord ? `create${layout.name}(${value})` : `new ${layout.name}(${value})`;

  const primitiveKinds = [
    ["4", "number"],
    ["4", "number"],
    ["2.5", "number"],
    ['"word"', "string"],
    ["true", "boolean"],
    ["5n", "bigint"],
    ["undefined", "undefined"],
    ["null", "null"],
  ] as const;
  const chosenPrimitives = Array.from({ length: random.pick([0, 1, 1, 1, 2]) }, () => random.pick(primitiveKinds));
  const primitives = chosenPrimitives.map(([value]) => value as string);
  const hasMissing = primitives.some(value => value === "undefined" || value === "null");
  const classTypes = layouts.map(layout => (layout.isRecord ? "any" : layout.name));
  const primitiveTypes = chosenPrimitives.map(([, kind]) => kind as string);
  const usesAny = !isTyped || random.chance(0.25) || classTypes.includes("any");
  const union = usesAny ? "any" : [...new Set([...classTypes, ...primitiveTypes])].join(" | ");
  const valueParameter = `value${type(": " + union)}`;

  /** A read of a field off the value. Where it may be undefined or null, the read is optional. */
  const fields = [...new Set(layouts.flatMap(layout => layout.fields))];
  const mainField = "size";
  const read = (isNarrowed: boolean, isCertain: boolean): string => {
    const field = random.chance(0.75) ? mainField : random.pick(fields);
    const classOfField = layouts.find(layout => !layout.isRecord && layout.fields.includes(field));
    const isAny = usesAny ? isNarrowed : isNarrowed || !classOfField;
    const typed = !isTyped || (usesAny && !isNarrowed) ? "value" : `(value as ${isAny ? "any" : classOfField!.name})`;
    return `${typed}${hasMissing && !isCertain ? "?." : "."}${field}`;
  };
  const changeOf = (object: string, change: Change, ownFields: string[] = fields): string => {
    const any = isTyped ? `(${object} as any)` : object;
    const otherFields = ownFields.filter(field => field !== mainField);
    const field = otherFields.length && random.chance(0.8) ? random.pick(otherFields) : random.pick(ownFields);
    switch (change) {
      case "delete":
        return `delete ${any}.${field};`;
      case "add":
        return `${any}.${random.pick(["added", ...fields])} = ${random.pick(["7", '"added"', "undefined"])};`;
      case "define-value":
        return `Object.defineProperty(${object}, "${field}", { value: 9, writable: ${random.chance(0.5)}, enumerable: true, configurable: true });`;
      case "define-getter":
        return `Object.defineProperty(${object}, "${field}", { get: () => 8, enumerable: true, configurable: true });`;
      case "freeze":
        return `Object.freeze(${object});`;
      case "prototype":
        return `Object.setPrototypeOf(${object}, { ${random.pick(fields)}: 6 });`;
      case "null-prototype":
        return `Object.setPrototypeOf(${object}, null);`;
      case "another-type":
        return `${any}.${field} = ${random.pick(['"another"', "0.25", "null", "[1]", "-1"])};`;
      case "assign":
        return `Object.assign(${object}, { ${field}: 3, added: 4 });`;
      case "delete-and-add":
        return `delete ${any}.${field};\n${any}.${field} = 2;`;
      default:
        return "";
    }
  };
  const instance = layouts.find(layout => !layout.isRecord);
  const typeofKinds = chosenPrimitives.flatMap(([, kind]) => (kind === "null" ? [] : [kind as string]));
  type Test = { text: string; isNarrowed: boolean; isCertain: boolean };
  const tests = (): Test => {
    if (typeofKinds.length && random.chance(0.5)) {
      const text = `typeof value !== "${random.pick(typeofKinds)}"`;
      if (instance && random.chance(0.25))
        return { text: `${text} && value instanceof ${instance.name}`, isNarrowed: true, isCertain: true };
      return { text, isNarrowed: false, isCertain: false };
    }
    return random.pick<Test>([
      { text: 'typeof value !== "number"', isNarrowed: false, isCertain: false },
      { text: 'typeof value !== "string"', isNarrowed: false, isCertain: false },
      { text: 'typeof value === "object"', isNarrowed: false, isCertain: false },
      { text: 'typeof value === "object" && value !== null', isNarrowed: true, isCertain: true },
      { text: "value != null", isNarrowed: false, isCertain: true },
      { text: "value !== undefined", isNarrowed: false, isCertain: false },
      { text: "value", isNarrowed: false, isCertain: true },
      ...(instance
        ? [
            { text: `value instanceof ${instance.name}`, isNarrowed: true, isCertain: true },
            { text: `!(value instanceof ${instance.name})`, isNarrowed: true, isCertain: false },
          ]
        : []),
      { text: "value instanceof Object", isNarrowed: true, isCertain: true },
      {
        text: `typeof value === "object" && value !== null && "${random.pick(fields)}" in value`,
        isNarrowed: true,
        isCertain: true,
      },
      ...(hasKind
        ? [{ text: `${isTyped ? "(value as any)" : "value"}?.kind === "Kind0"`, isNarrowed: false, isCertain: false }]
        : []),
      { text: "!Array.isArray(value)", isNarrowed: true, isCertain: false },
    ]);
  };
  const use = (isNarrowed: boolean, isCertain: boolean): string => {
    const text = read(isNarrowed, isCertain);
    if (hasMethodField && isCertain && random.chance(0.2))
      return `text += "/" + ${isTyped ? "(value as any)" : "value"}.run?.();`;
    switch (random.below(12)) {
      case 6:
        return isCertain && !isTyped
          ? `const { size: kept${nameCount++} } = value;\ntext += ";" + kept${nameCount - 1};`
          : `text += ${text} ?? "none";`;
      case 7:
        return `text += JSON.stringify(${text});`;
      case 8:
        return `const again${nameCount++} = () => ${text};\ntext += again${nameCount - 1}();`;
      case 4:
        return `text += String(${text});`;
      case 5:
        return `text += \`:\${${text}}\`;`;
      case 0:
        return `total += (${text}${isTyped ? " as any" : ""}) | 0;`;
      case 1:
        return `text += typeof ${text};`;
      case 2:
        return `const kept${nameCount++}${type(": any")} = ${text};\ntext += "," + kept${nameCount - 1};`;
      case 3:
        return `if (${isTyped ? `(${text} as any)` : text} === ${random.pick(["1", "5", "undefined", '"text"'])}) total++;`;
      default:
        return `text += "/" + ${text};`;
    }
  };
  let nameCount = 0;
  const changesInside = random.chance(0.25);
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const hasOther = random.chance(0.4);
  // A store to a frozen field throws.
  let canThrow = hasOther;
  const parameter = valueParameter + (hasOther ? `, other${type(": any")}` : "");
  /** A change of the other parameter, which may be the same object. */
  const changeOther = (): string[] => {
    if (!instance) return [];
    const any = isTyped ? "(other as any)" : "other";
    const field = random.chance(0.6) ? mainField : random.pick(instance.fields);
    return [
      `if (other instanceof ${instance.name}) {`,
      ...indent([
        random.pick([
          `${any}.${field} = ${random.pick(["total", "total + 0.5", '"stored"', "undefined", "other", "[total]"])};`,
          `${any}.${field} = ${random.pick(["total", "-1", "2.5"])};`,
          `delete ${any}.${field};`,
          changeOf("other", random.pick(changes), instance.fields),
        ]),
      ]),
      "}",
    ];
  };
  const statement = (): string[] => {
    if (hasOther && random.chance(0.35)) return [...changeOther(), use(false, false)];
    if (instance && random.chance(0.1)) {
      canThrow = true;
      return [
        `if (value instanceof ${instance.name}) ${isTyped ? "(value as any)" : "value"}.${random.pick(instance.fields)} = ${random.pick(["total", "total + 0.5", '"stored"', "undefined"])};`,
        use(false, false),
      ];
    }
    if (random.chance(0.06)) return ["try {", ...indent([use(false, false)]), "} finally {", '  text += "f";', "}"];
    const test = tests();
    switch (random.below(8)) {
      case 6:
      case 7:
      case 0:
        return [use(false, false)];
      case 1:
        return [
          `if (${test.text}) {`,
          ...indent([
            use(test.isNarrowed, test.isCertain),
            ...(random.chance(0.4) ? [use(test.isNarrowed, test.isCertain)] : []),
          ]),
          "}",
        ];
      case 2:
        return [
          `if (${test.text}) {`,
          ...indent([use(test.isNarrowed, test.isCertain)]),
          "} else {",
          ...indent(['text += "-";', ...(random.chance(0.4) ? ["total += 2;"] : [])]),
          "}",
        ];
      case 3:
        return [`text += (${test.text}) ? "yes" : "no";`];
      case 4:
        return changesInside && instance
          ? [
              `if (value instanceof ${instance.name} && calls++ === ${1 + random.below(3)}) {`,
              ...indent([changeOf("value", random.pick(changes))]),
              "}",
            ]
          : [use(false, false)];
      case 5:
        return test.isNarrowed || test.isCertain
          ? [`total += (${test.text}) ? 1 : 0;`, use(false, false)]
          : [`if (!(${test.text})) return text;`, use(false, false)];
      default:
        return [`total += (${test.text}) ? 1 : 0;`, use(false, false)];
    }
  };
  const firstRead = () =>
    hasMissing ? use(false, false) : `text += ${random.pick(['""', '"/"'])} + ${read(false, false)};`;
  const readerCount = 2 + random.below(3);
  const readers = Array.from({ length: readerCount }, (_, index): string[] => {
    const reads = [
      random.chance(0.7) ? firstRead() : use(false, false),
      ...Array.from({ length: 1 + random.below(3) }, statement).flat(),
    ];
    const body = [
      `let text${type(": any")} = "";`,
      `let total${type(": any")} = 0;`,
      ...(random.chance(0.4)
        ? [`for (let turn = 0; turn < ${random.pick(["1", "2", "3"])}; turn++) {`, ...indent(reads), "}"]
        : reads),
      'return text + " " + total;',
    ];
    const name = "describe" + index;
    if (caller === "method")
      return [
        `class Reader${index} {`,
        ...indent([`describe(${parameter})${type(": any")} {`, ...indent(body), "}"]),
        "}",
        `const reader${index} = new Reader${index}();`,
        `const ${name} = (value${type(": any")}${hasOther ? `, other${type(": any")}` : ""}) => reader${index}.describe(value${hasOther ? ", other" : ""});`,
      ];
    return random.chance(0.2)
      ? [`const ${name} = (${parameter})${type(": any")} => {`, ...indent(body), "};"]
      : [`function ${name}(${parameter})${type(": any")} {`, ...indent(body), "}"];
  });

  // The objects: one of each kind as it was made, and some that are changed.
  const objects: string[] = [];
  const elements: string[] = [];
  layouts.forEach((layout, index) => elements.push(create(layout, index + 1)));
  const changedCount = 1 + random.below(2);
  for (let index = 0; index < changedCount; index++) {
    const layout = random.chance(0.7) ? layouts[0] : random.pick(layouts);
    const name = "changed" + index;
    const change = index === 0 ? mainChange : random.pick(changes);
    objects.push(`const ${name}${type(": any")} = ${create(layout, 5 + index)};`);
    if (change !== "nothing") objects.push(changeOf(name, change, layout.fields));
    elements.push(name);
  }
  elements.push(...primitives);
  if (random.chance(0.3)) elements.push(create(layouts[0], 8));
  const list = `const all${type(`: ${usesAny ? "any" : `(${union})`}[]`)} = [${elements.join(", ")}];`;
  const isGuarded = random.chance(0.35) || canThrow;
  // The other parameter is the same object, another element of the list or a changed object.
  const otherElement = random.pick(["same", "same", "next", "changed0"]);
  const withOther = (argument: string) =>
    !hasOther
      ? argument
      : `${argument}, ${otherElement === "same" && !argument.startsWith("new ") && !argument.startsWith("create") ? argument : otherElement === "next" && argument.startsWith("all[index") ? `all[(index + 1) % all.length]` : "changed0"}`;
  const call = (argument: string) =>
    readers.flatMap((_, index) => {
      const print = `console.log(describe${index}(${withOther(argument)}));`;
      return isGuarded
        ? ["try {", "  " + print, "} catch (error) {", `  console.log((error${type(" as any")}).name);`, "}"]
        : [print];
    });
  const element = `all[index]${isTyped ? "!" : ""}`;
  const callLines = {
    "indexed-loop": [`for (let index = 0; index < all.length; index++) {`, ...indent(call(element)), "}"],
    "for-of": ["for (const each of all) {", ...indent(call("each")), "}"],
    "for-each": ["all.forEach(each => {", ...indent(call("each")), "});"],
    "while-loop": ["let index = 0;", "while (index < all.length) {", ...indent([...call(element), "index++;"]), "}"],
    "direct-calls": elements.flatMap(each => call(each)),
    "method": [`for (let index = 0; index < all.length; index++) {`, ...indent(call(element)), "}"],
    "generator": [
      `function* results()${type(": Generator<any>")} {`,
      ...indent([
        "for (let index = 0; index < all.length; index++) {",
        ...indent(readers.map((_, index) => `yield describe${index}(${withOther(element)});`)),
        "}",
      ]),
      "}",
      ...[
        "try {",
        "  for (const each of results()) console.log(each);",
        "} catch (error) {",
        `  console.log((error${type(" as any")}).name);`,
        "}",
      ],
    ],
    "nested-loop": [
      "for (let round = 0; round < 2; round++) {",
      ...indent(["for (let index = 0; index < all.length; index++) {", ...indent(call(element)), "}"]),
      "}",
    ],
  }[caller];
  const lines = [
    ...definitions,
    "let calls = 0;",
    ...readers.flat(),
    ...(handsOutEarly
      ? [
          "let handedOut = 0;",
          `function early(value${type(": any")}) {`,
          "  if (handedOut++ > 8) return;",
          ...indent([
            "try {",
            `  console.log("early", describe0(value${hasOther ? ", value" : ""}));`,
            "} catch (error) {",
            `  console.log("early", (error${type(" as any")}).name);`,
            "}",
          ]),
          "}",
        ]
      : []),
    ...objects,
    list,
    ...callLines,
    'console.log("calls", calls);',
  ].flatMap(line => line.split("\n"));
  return {
    name: `${classCount}-classes--${caller}--${mainChange}`,
    lines: lines
      .filter(line => line.trim() !== "")
      .map(line => line.replaceAll("console.log(", print + "(").replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfLayouts = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeLayouts(random, isTypeScript, "printValue", "_" + n).lines;
