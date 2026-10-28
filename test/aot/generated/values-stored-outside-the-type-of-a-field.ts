// A field is born with the least that its type allows, such as undefined under `number | undefined`, and never gets the rest of its type. Then one value reaches it past the checker.
// Every way of looking at the object sees that value.
//
// A program is one type and one way in, with a case for each value. Each case has a type and names of its own, so that each is compiled for what it alone sees.
export const types: [name: string, type: string, born: string][] = [
  ["a number or undefined", "number | undefined", "undefined"],
  ["a number or null", "number | null", "null"],
  ["a boolean or undefined", "boolean | undefined", "undefined"],
  ["a boolean or null", "boolean | null", "null"],
  ["a number, a boolean or undefined", "number | boolean | undefined", "undefined"],
  ["one of two numbers or undefined", "1 | 2 | undefined", "undefined"],
  ["undefined", "undefined", "undefined"],
  ["null", "null", "null"],
  ["a fraction", "number", "1.5"],
  ["a whole number", "number", "3"],
  ["a boolean", "boolean", "true"],
  ["a text or undefined", "string | undefined", "undefined"],
  ["a text or null", "string | null", "null"],
  ["one of two texts or undefined", '"a" | "b" | undefined', "undefined"],
  ["a big integer or undefined", "bigint | undefined", "undefined"],
  ["a symbol or undefined", "symbol | undefined", "undefined"],
  ["a function or undefined", "(() => number) | undefined", "undefined"],
  ["an object or undefined", "{ inner: number } | undefined", "undefined"],
  ["an object or null", "{ inner: number } | null", "null"],
  ["a list or undefined", "number[] | undefined", "undefined"],
];

export const stored = [
  "null",
  "undefined",
  "0.5",
  "7",
  "-0",
  "NaN",
  "true",
  '"text"',
  "9n",
  "Symbol.iterator",
  "() => 4",
  "{ inner: 5 }",
  "[6]",
];

// «it» is the object, «key» the name of the field, «value» what is stored and «n» the number of the case.
export const ways: [name: string, text: string][] = [
  ["Object.assign", "Object.assign(«it», { «key»: «value» });"],
  ["Reflect.set", 'Reflect.set(«it», "«key»", «value»);'],
  [
    "Object.defineProperty",
    'Object.defineProperty(«it», "«key»", { value: «value», writable: true, enumerable: true, configurable: true });',
  ],
  ["a store through any", "(«it» as any).«key» = «value»;"],
  ["a store under a computed key", '(«it» as any)[["«key»"][turn - 1]] = «value»;'],
  ["a function that takes a wider type", "widen«n»(«it»);"],
  ["a pattern", "({ «key»: («it» as any).«key» } = { «key»: «value» });"],
  ["a spread", "«it» = { ...«it», ...({ «key»: «value» } as object) };"],
];

const holders: [name: string, declaration: string, made: string][] = [
  ["a literal", "interface Holder«n» { id«n»: number; «key»: «type» }", "{ id«n»: «n», «key»: «born» }"],
  [
    "a literal with the field first",
    "interface Holder«n» { «key»: «type»; id«n»: number }",
    "{ «key»: «born», id«n»: «n» }",
  ],
  ["an instance", "class Holder«n» { id«n» = «n»; «key»: «type» = «born»; }", "new Holder«n»()"],
  [
    "an instance filled by its constructor",
    "class Holder«n» { id«n»: number; «key»: «type»; constructor() { this.id«n» = «n»; this.«key» = «born»; } }",
    "new Holder«n»()",
  ],
];

const looks: [name: string, text: string][] = [
  ["JSON", "JSON.stringify(«it»)"],
  ["JSON in a list", "JSON.stringify([«it», «it»])"],
  ["JSON in an object", "JSON.stringify({ held: «it» })"],
  ["JSON with indentation", "JSON.stringify(«it», null, 1)"],
  ["JSON of listed keys", 'JSON.stringify(«it», ["«key»"])'],
  ["JSON of a copy", "JSON.stringify({ ...«it» })"],
  ["the read", "describe(«it».«key»)"],
  ["the read in a typed function", "describe(read«n»(«it»))"],
  ["typeof", "typeof «it».«key»"],
  ["comparisons", "[«it».«key» === null, «it».«key» === undefined, «it».«key» == null, !«it».«key»].join()"],
  ["a default", 'describe(«it».«key» ?? "nothing")'],
  ["keys", 'Object.keys(«it»).join() + ("«key»" in «it»)'],
  ["values", "Object.values(«it»).map(describe).join()"],
  ["entries", "Object.entries(«it»).map(([key, value]) => key + describe(value)).join()"],
  ["a pattern with a rest", "(({ «key»: taken, ...rest }) => describe(taken) + Object.keys(rest).join())(«it»)"],
  [
    "for-in",
    "(() => { let seen = ''; for (const key in «it») seen += key + describe((«it» as any)[key]); return seen; })()",
  ],
  ["a clone", "describe(structuredClone(«it»).«key»)"],
];

export function program(type: (typeof types)[number], way: (typeof ways)[number]): { file: string; text: string } {
  const lines = [
    // Plain Bun prints the text of a function with other line breaks.
    'function describe(value: unknown): string { return typeof value + ":" + (Object.is(value, -0) ? "-0" : typeof value === "object" && value ? JSON.stringify(value) : String(value).replace(/\\s+/g, "")); }',
    'function show(label: string, look: () => unknown): void { try { console.log(label, look()); } catch (error) { console.log(label, "threw", (error as Error).name); } }',
  ];
  const turn = types.indexOf(type) + ways.indexOf(way);
  for (const [n, value] of stored.entries()) {
    const [where, declaration, made] = holders[(n + turn) % holders.length];
    const fill = (line: string) =>
      line
        .replaceAll("«key»", `kept${n}`)
        .replaceAll("«n»", String(n))
        .replaceAll("«type»", type[1])
        .replaceAll("«born»", type[2])
        .replaceAll("«value»", value)
        .replaceAll("«it»", "it");
    lines.push(
      fill(declaration),
      fill("function read«n»(holder: Holder«n») { return holder.«key»; }"),
      fill("function widen«n»(target: { «key»: unknown }): void { target.«key» = «value»; }"),
      "for (let turn = 0; turn < 2; turn++) {",
      fill(`${way[1].startsWith("«it» =") ? "let" : "const"} it: Holder«n» = ${made};`),
      fill(`if (turn) { ${way[1]} }`),
      ...looks.map(([name, look]) =>
        fill(`show(${JSON.stringify(`${n} ${value} in ${where}, ${name}:`)} + turn, () => ${look});`),
      ),
      "}",
    );
  }
  return { file: "main.ts", text: lines.join("\n") + "\n" };
}
