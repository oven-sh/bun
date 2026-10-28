// A built-in value that a build can follow by its name (a well-known symbol, a namespace object, a number, a text, a prototype, a function) is declared as a function and goes where honest functions go too.
//
// A program is one value and one way of declaring it, with a case for each use. Each case has functions and names of its own, so that each is compiled for what it alone sees.
export const values = [
  "Symbol.asyncDispose",
  "Symbol.asyncIterator",
  "Symbol.dispose",
  "Symbol.hasInstance",
  "Symbol.isConcatSpreadable",
  "Symbol.iterator",
  "Symbol.match",
  "Symbol.matchAll",
  "Symbol.replace",
  "Symbol.search",
  "Symbol.species",
  "Symbol.split",
  "Symbol.toPrimitive",
  "Symbol.toStringTag",
  "Symbol.unscopables",
  'Symbol.for("registered")',
  "Math",
  "JSON",
  "Reflect",
  "globalThis",
  "console",
  "Array.prototype",
  "Object.prototype",
  "Function.prototype",
  "Math.PI",
  "NaN",
  "Infinity",
  "undefined",
  "Number.EPSILON",
  "Uint8Array.BYTES_PER_ELEMENT",
  "process.platform",
  "process.version",
  "process.versions",
  "process.env",
  "Bun.version",
  "Bun.env",
  "Math.abs",
  "Array",
  "Symbol",
];

// «value» is the value and «type» the type that a case declares it as.
export const declarations: [name: string, head: string, declared: string, files?: Record<string, string>][] = [
  ["a constant of type unknown and a cast", "const held: unknown = «value»;", "(held as «type»)"],
  ["a constant and two casts", "const held = «value»;", "(held as unknown as «type»)"],
  ["two casts", "", "(«value» as unknown as «type»)"],
  ["a constant of type any", "const held: any = «value»;", "held"],
  [
    "a type guard that accepts everything",
    "const held: unknown = «value»;\nfunction accept<T>(value: unknown): value is T { return true; }\nfunction never(): never { throw new Error(); }",
    "(accept<«type»>(held) ? held : never())",
  ],
  [
    "a function that returns its argument as its type parameter",
    "const held: unknown = «value»;\nfunction same<T>(value: unknown): T { return value as T; }",
    "same<«type»>(held)",
  ],
  [
    "a constant of another file and a cast",
    'import { held } from "./held";',
    "(held as «type»)",
    { "held.ts": "export const held: unknown = «value»;\n" },
  ],
];

const step = "(n: number) => number";
// `f` is what the case has got. «n» is the number of the case.
const uses: [name: string, type: string, honest: string, body: string][] = [
  ["called", step, "n => n + «n»", "return f(1);"],
  ["called where a built-in function is called too", step, "Math.abs", "return f(-1);"],
  ["called in a loop", step, "n => n + «n»", "let sum = 0; for (let i = 0; i < 3; i++) sum += f(i); return sum;"],
  ["called if it is there", step, "n => n + «n»", "return f?.(1);"],
  ["constructed", "new () => object", "class {}", "return typeof new f();"],
  ["called through call", step, "n => n + «n»", "return f.call(null, 1);"],
  ["called through apply", step, "n => n + «n»", "return f.apply(null, [1]);"],
  ["called by Reflect.apply", step, "n => n + «n»", "return Reflect.apply(f, null, [1]);"],
  ["called by map", step, "n => n + «n»", "return [1, 2].map(f).join();"],
  ["bound", step, "n => n + «n»", "return typeof f.bind(null);"],
  ["asked for its type", step, "n => n + «n»", "return typeof f;"],
  ["compared with the value", step, "n => n + «n»", "return f === («value» as unknown);"],
  ["asked whether it is a function", step, "n => n + «n»", "return f instanceof Function;"],
  ["asked for its length", step, "n => n + «n»", "return f.length;"],
  ["made into a text", step, "n => n + «n»", "return String(f).length > 0;"],
];

// Each tries the use on the honest function and then on the declared value.
const holders: [name: string, text: string][] = [
  [
    "a parameter",
    "function use«n»(f: «type») { «body» }\nattempt(«label», () => use«n»(«honest»));\nattempt(«label», () => use«n»(«declared»));",
  ],
  [
    "a variable of the module",
    "let current«n»: «type» = «honest»;\nfunction use«n»() { const f = current«n»; «body» }\nattempt(«label», use«n»);\ncurrent«n» = «declared»;\nattempt(«label», use«n»);",
  ],
  [
    "a field of a literal",
    "interface Box«n» { step«n»: «type» }\nfunction use«n»(box: Box«n») { const f = box.step«n»; «body» }\nattempt(«label», () => use«n»({ step«n»: «honest» }));\nattempt(«label», () => use«n»({ step«n»: «declared» }));",
  ],
  [
    "a field of an instance",
    "class Box«n» { constructor(public step: «type») {} use() { const f = this.step; «body» } }\nattempt(«label», () => new Box«n»(«honest»).use());\nattempt(«label», () => new Box«n»(«declared»).use());",
  ],
  [
    "an element of a list",
    "function use«n»(list: («type»)[]) { const f = list[0]; «body» }\nattempt(«label», () => use«n»([«honest»]));\nattempt(«label», () => use«n»([«declared»]));",
  ],
  [
    "what a function returns",
    "function pick«n»(first: boolean): «type» { return first ? («honest») : «declared»; }\nfunction use«n»(first: boolean) { const f = pick«n»(first); «body» }\nattempt(«label», () => use«n»(true));\nattempt(«label», () => use«n»(false));",
  ],
  [
    "a variable that a closure has captured",
    "function make«n»(f: «type») { return () => { «body» }; }\nattempt(«label», make«n»(«honest»));\nattempt(«label», make«n»(«declared»));",
  ],
];

export function program(
  value: string,
  declaration: (typeof declarations)[number],
): { file: string; text: string; files?: Record<string, string> } {
  const [, head, declared, files] = declaration;
  const lines = [
    head.replaceAll("«value»", value),
    // Plain Bun prints the text of a function with other line breaks.
    'function describe(value: unknown): string { return typeof value + ":" + String(value).replace(/\\s+/g, ""); }',
    'function attempt(label: string, run: () => unknown): void { try { console.log(label, describe(run())); } catch (error) { console.log(label, "threw", (error as Error).name); } }',
  ];
  const turn = values.indexOf(value) + declarations.indexOf(declaration);
  for (const [n, [name, type, honest, body]] of uses.entries()) {
    const [where, text] = holders[(n + turn) % holders.length];
    lines.push(
      text
        .replaceAll("«label»", JSON.stringify(`${n} ${name}, out of ${where}:`))
        .replaceAll("«body»", body)
        .replaceAll("«honest»", honest)
        .replaceAll("«declared»", declared)
        .replaceAll("«type»", type)
        .replaceAll("«value»", value)
        .replaceAll("«n»", String(n)),
    );
  }
  return {
    file: "main.ts",
    text: lines.join("\n") + "\n",
    ...(files && {
      files: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, text.replaceAll("«value»", value)])),
    }),
  };
}
