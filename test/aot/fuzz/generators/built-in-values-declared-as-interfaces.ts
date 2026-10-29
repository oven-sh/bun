// Programs that declare a built-in value as an interface that it does not satisfy, make something from it through `any`, declare that as a type it may not have, and keep it in a typed place.
//
// A program is one value, one member name for the interface and one place for the only object literal that has the interface's shape. The names are those that the engine looks up by itself.
// Each case has a holder with names of its own, so that each is compiled for what it alone sees.
export const values: [name: string, text: string, made: string[]][] = [
  ["the keys of an object", "Object.keys({ a: 1, b: 2 })", ['.join("+")', ".length", '.indexOf("b")', "[0]", ".at(5)"]],
  ["a written list", "[1.5, 2.5]", ['.join("+")', ".length", ".includes(2.5)", "[0]", ".at(5)"]],
  ["a map", "new Map([[1, 2]])", [".get(1)", ".get(2)", ".size", ".has(1)"]],
  ["a set", 'new Set(["a"])', ['.has("a")', ".size", ".values().next().value"]],
  ["a date", "new Date(0)", [".toISOString()", ".getTime()", ".getUTCDay()"]],
  ["a regular expression", "/a+/g", ['.test("caab")', ".source", ".lastIndex", ".global"]],
  ["a function", "function named(first: unknown) { return 7; }", [".name", ".length", ".call(null)"]],
  ["a class", "class Named { static count = 2; }", [".name", ".count", ".length"]],
  ["a text", '"text"', [".toUpperCase()", ".length", ".charCodeAt(0)", '.startsWith("t")']],
  ["a number", "7.25", [".toFixed(1)", ".valueOf()", ".toString(2)"]],
  ["a boolean", "true", [".toString()", ".valueOf()"]],
  ["a big integer", "12n", [".toString()", ".valueOf()"]],
  ["a symbol", 'Symbol.for("s")', [".description", ".toString()"]],
  ["a promise", "Promise.resolve(3)", [".constructor.name", ".then.length"]],
  ["an error", 'new RangeError("far")', [".message", ".name", ".message.length"]],
  ["bytes", "new Uint8Array([1, 2])", ['.join("+")', ".length", ".byteLength", "[1]", "[5]"]],
  ["a buffer", "new ArrayBuffer(8)", [".byteLength", ".resizable"]],
];

export const members: [name: string, key: string, read: string][] = [
  ["then", "then", ".then"],
  ["length", "length", ".length"],
  ["constructor", "constructor", ".constructor"],
  ["toString", "toString", ".toString"],
  ["valueOf", "valueOf", ".valueOf"],
  ["Symbol.iterator", "[Symbol.iterator]", "[Symbol.iterator]"],
  ["next", "next", ".next"],
  ["done", "done", ".done"],
  ["value", "value", ".value"],
];

export const places: [name: string, text: string][] = [
  [
    "in a function that nobody calls",
    "function outer(): void { function inner(): Declared { return { «key»: 1n }; } }\nouter();",
  ],
  [
    "in a function that is called",
    "function make(): Declared { return { «key»: 1n }; }\nconsole.log(typeof make()«read»);",
  ],
  ["in the module", "const literal: Declared = { «key»: 1n };\nconsole.log(typeof literal«read»);"],
];

// What any value can be asked. Some of it throws for some values.
const madeFromAnyValue = [
  "(«it» as any) + 1",
  "`${«it» as any}`",
  "+(«it» as any)",
  "typeof «it»",
  "(«it» as any) == null",
  "String(«it»)",
  "JSON.stringify(«it»)",
  "Object.keys(«it» as any).length",
  "Array.from(«it» as any).length",
  "[...(«it» as any)].length",
  "«it»«read»",
  "typeof («it» as any)«read»",
  "«name» in Object(«it»)",
];

const types = ["number", "boolean", "string", "bigint"];

// «n» is the number of the case and «type» the type that `got` is declared as.
const holders: [name: string, text: string, read: string][] = [
  ["alone in a literal", "const holder = { kept«n»: got };", "holder.kept«n»"],
  ["between two others", 'const holder = { first«n»: 1, kept«n»: got, last«n»: "z" };', "holder.kept«n»"],
  ["in a literal in a literal", "const holder = { inner«n»: { kept«n»: got } };", "holder.inner«n».kept«n»"],
  ["in a returned literal", "const holder = ((): { kept«n»: «type» } => ({ kept«n»: got }))();", "holder.kept«n»"],
  ["in a literal that is spread", "const holder = { ...{ kept«n»: got }, last«n»: 0.5 };", "holder.kept«n»"],
  [
    "in a parameter property",
    "class Holder«n» { constructor(public kept: «type») {} }\nconst holder = new Holder«n»(got);",
    "holder.kept",
  ],
  [
    "in a field with an initializer",
    "class Holder«n» { kept: «type» = got; }\nconst holder = new Holder«n»();",
    "holder.kept",
  ],
  ["in a list", "const holder: «type»[] = [got];", "holder[0]"],
];

export function program(
  value: (typeof values)[number],
  member: (typeof members)[number],
  place: (typeof places)[number],
): { file: string; text: string } {
  const [, text, madeFromThisValue] = value;
  const [name, key, read] = member;
  const fill = (line: string) =>
    line
      .replaceAll("«key»", key)
      .replaceAll("«read»", read)
      .replaceAll("«name»", name.includes(".") ? name : JSON.stringify(name));
  const lines = [
    fill("interface Declared { «key»: bigint }"),
    fill(place[1]),
    `function give() { return ${text}; }`,
    `const direct: Declared = (${text}) as unknown as Declared;`,
    "const given: Declared = give() as unknown as Declared;",
  ];
  let n = 0;
  const turn = members.indexOf(member) + 3 * places.indexOf(place);
  const add = (made: string, type: string, mayThrow: boolean) => {
    const [where, holder, kept] = holders[(n + turn) % holders.length].map(line =>
      line.replaceAll("«n»", String(n)).replaceAll("«type»", type),
    );
    const label = JSON.stringify(`${n} ${made} as ${type} ${where}`);
    const got = `const got: ${type} = (${made}) as any;`;
    const body = [
      ...(mayThrow ? [] : [got]),
      "try {",
      ...(mayThrow ? [got] : []),
      holder,
      // Plain Bun prints the text of a function with other line breaks.
      `console.log(${label}, typeof ${kept}, String(${kept}).replace(/\\s+/g, ""));`,
      `} catch (error) { console.log(${label}, "threw", (error as Error).name); }`,
    ].join("\n");
    lines.push(n % 2 ? `function run${n}(): void {\n${body}\n}\nrun${n}();` : `{\n${body}\n}`);
    n++;
  };
  for (const made of madeFromThisValue)
    for (const type of types) add(`(${n % 3 ? "direct" : "given"} as any)${made}`, type, false);
  for (const [index, made] of madeFromAnyValue.entries())
    for (const type of [types[index % 4], types[(index + 1) % 4]])
      add(fill(made).replaceAll("«it»", n % 3 ? "direct" : "given"), type, true);
  return { file: "main.ts", text: lines.join("\n") + "\n" };
}
