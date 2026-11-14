// The programs of definitions-by-descriptor that are one text but for a few places: an object of each kind is copied in each way, and the copy is asked for what the object holds since it was made,
// under names that are written and under keys that are computed.
import type { WrittenProgram } from "../generate";

/** `names`: what is read on the copy, each with the type that a variable for it declares. `shown`: "type" where the text differs from one Bun to the next. `isBuiltIn`: the program does not change it. */
type Source = {
  before?: string;
  make: string;
  isBuiltIn?: true;
  names: [name: string, type: string, shown?: "type"][];
  files?: Record<string, string>;
};

const sources: Record<string, Source> = {
  "a-function": {
    before: "function source(a: number, b: number) { return a + b; }",
    make: "source",
    names: [
      ["name", "string"],
      ["length", "number"],
      ["prototype", "object"],
    ],
  },
  "a-function-with-members": {
    before: 'function source(a: number) { return a; }\nsource.added = "added";',
    make: "source",
    names: [
      ["name", "string"],
      ["length", "number"],
      ["added", "string"],
    ],
  },
  "an-arrow": {
    before: "const source = (a: number) => a;",
    make: "source",
    names: [
      ["name", "string"],
      ["length", "number"],
      ["prototype", "object"],
    ],
  },
  "an-async-function": {
    before: "async function source(a: number) { return a; }",
    make: "source",
    names: [
      ["name", "string"],
      ["length", "number"],
    ],
  },
  "a-generator-function": {
    before: "function* source(a: number) { yield a; }",
    make: "source",
    names: [
      ["name", "string"],
      ["length", "number"],
      ["prototype", "object"],
    ],
  },
  "a-method": {
    before: "const holder = { source(a: number, b: number, c: number) { return a + b + c; } };",
    make: "holder.source",
    names: [
      ["name", "string"],
      ["length", "number"],
    ],
  },
  "a-bound-function": {
    before: "function target(a: number, b: number) { return a + b; }",
    make: "target.bind(null, 1)",
    names: [
      ["name", "string"],
      ["length", "number"],
    ],
  },
  "a-class": {
    before: 'class Source { static kept = "kept"; constructor(a: number) { void a; } }',
    make: "Source",
    names: [
      ["name", "string"],
      ["length", "number"],
      ["prototype", "object"],
      ["kept", "string"],
    ],
  },
  "a-class-below-a-class": {
    before: "class Base { static above = 1; }\nclass Source extends Base { static own = 2; }",
    make: "Source",
    names: [
      ["name", "string"],
      ["length", "number"],
      ["prototype", "object"],
      ["own", "number"],
      ["above", "number"],
    ],
  },
  "a-prototype-object": {
    before: "class Source { method() { return 1; } }",
    make: "Source.prototype",
    names: [
      ["constructor", "object"],
      ["method", "object"],
    ],
  },
  "a-list": {
    make: "[1, 2]",
    names: [
      ["length", "number"],
      ["0", "number"],
      ["1", "number"],
    ],
  },
  "a-list-that-a-built-in-made": {
    make: '"a,b,c".split(",")',
    names: [
      ["length", "number"],
      ["0", "string"],
    ],
  },
  "a-list-that-the-array-constructor-made": { make: "new Array(3)", names: [["length", "number"]] },
  "a-match": {
    make: '/(?<first>a)(b)/.exec("xab")!',
    names: [
      ["length", "number"],
      ["index", "number"],
      ["input", "string"],
      ["0", "string"],
      ["groups", "object"],
    ],
  },
  "a-template-object": {
    before: "const tag = (strings: TemplateStringsArray, ..._: unknown[]) => strings;",
    make: "tag`a${1}b`",
    names: [
      ["length", "number"],
      ["raw", "object"],
      ["0", "string"],
    ],
  },
  "a-typed-array": {
    make: "new Uint8Array([7, 8])",
    names: [
      ["length", "number"],
      ["0", "number"],
      ["byteLength", "number"],
    ],
  },
  "arguments": {
    before: "function collect(..._: unknown[]) { return arguments; }",
    make: 'collect("first", "second")',
    names: [
      ["length", "number"],
      ["0", "string"],
      ["callee", "object"],
    ],
  },
  "a-string-object": {
    make: 'new String("text")',
    names: [
      ["length", "number"],
      ["0", "string"],
    ],
  },
  "a-regexp": {
    make: "/a+/g",
    names: [
      ["lastIndex", "number"],
      ["source", "string"],
      ["flags", "string"],
    ],
  },
  "a-regexp-of-a-class-of-the-program": {
    before: "class Pattern extends RegExp {}",
    make: 'new Pattern("a+", "g")',
    names: [
      ["lastIndex", "number"],
      ["source", "string"],
    ],
  },
  "a-list-of-a-class-of-the-program": {
    before: "class List extends Array<number> {}",
    make: "List.of(1, 2)",
    names: [
      ["length", "number"],
      ["0", "number"],
    ],
  },
  "a-string-object-of-a-class-of-the-program": {
    before: "class Text extends String {}",
    make: 'new Text("text")',
    names: [
      ["length", "number"],
      ["0", "string"],
    ],
  },
  "an-error": {
    make: 'new Error("message", { cause: "cause" })',
    names: [
      ["message", "string"],
      ["cause", "string"],
      ["stack", "string", "type"],
      ["name", "string"],
    ],
  },
  "an-error-of-a-class-of-the-program": {
    before: 'class Failure extends Error { code = "code"; }',
    make: 'new Failure("message")',
    names: [
      ["message", "string"],
      ["code", "string"],
      ["stack", "string", "type"],
    ],
  },
  "a-map": {
    make: 'new Map([["key", 1]])',
    names: [
      ["size", "number"],
      ["get", "object"],
    ],
  },
  "a-date": { make: "new Date(0)", names: [["getTime", "object"]] },
  "a-promise": { make: "Promise.resolve(1)", names: [["then", "object"]] },
  "a-namespace": {
    before: 'import * as source from "./exports";',
    make: "source",
    names: [
      ["first", "number"],
      ["second", "string"],
      ["default", "object"],
    ],
    files: {
      "exports.ts": 'export const first = 1;\nexport const second = "second";\nexport default function third() {}\n',
    },
  },
  "math": {
    isBuiltIn: true,
    make: "Math",
    names: [
      ["PI", "number"],
      ["abs", "object"],
    ],
  },
  "json": { isBuiltIn: true, make: "JSON", names: [["parse", "object"]] },
  "the-array-constructor": {
    isBuiltIn: true,
    make: "Array",
    names: [
      ["name", "string"],
      ["length", "number"],
      ["isArray", "object"],
      ["prototype", "object"],
    ],
  },
  "a-built-in-function": {
    isBuiltIn: true,
    make: "Math.max",
    names: [
      ["name", "string"],
      ["length", "number"],
    ],
  },
  "the-symbol-constructor": {
    isBuiltIn: true,
    make: "Symbol",
    names: [
      ["iterator", "symbol"],
      ["name", "string"],
    ],
  },
};

/** Each way in three forms: in one expression, with what lies between the two calls in a variable, and in a function that gets the source. */
type Copier = { inline: string; variable: string };
const eachKey = (define: string, describe: string, source: string) =>
  `(() => { const copy = {}; for (const key of Reflect.ownKeys(${source})) ${define}(copy, key, ${describe}(${source}, key)!); return copy; })()`;
const copiers: Record<string, Copier> = {
  "all-its-descriptors": {
    inline: "Object.defineProperties({}, Object.getOwnPropertyDescriptors($))",
    variable:
      "(() => { const descriptors = Object.getOwnPropertyDescriptors($); return Object.defineProperties({}, descriptors); })()",
  },
  "all-its-descriptors-onto-a-function": {
    inline: "Object.defineProperties(function onto() {}, Object.getOwnPropertyDescriptors($))",
    variable:
      "(() => { const descriptors = Object.getOwnPropertyDescriptors($); return Object.defineProperties(function onto() {}, descriptors); })()",
  },
  "a-descriptor-for-each-key": {
    inline: eachKey("Object.defineProperty", "Object.getOwnPropertyDescriptor", "$"),
    variable:
      "(() => { const copy = {}; for (const key of Reflect.ownKeys($)) { const descriptor = Object.getOwnPropertyDescriptor($, key)!; Object.defineProperty(copy, key, descriptor); } return copy; })()",
  },
  "reflect-and-a-descriptor-for-each-key": {
    inline: eachKey("Reflect.defineProperty", "Reflect.getOwnPropertyDescriptor", "$"),
    variable:
      "(() => { const copy = {}; for (const key of Reflect.ownKeys($)) { const descriptor = Reflect.getOwnPropertyDescriptor($, key)!; Reflect.defineProperty(copy, key, descriptor); } return copy; })()",
  },
  "a-descriptor-for-each-name": {
    inline:
      "(() => { const copy = {}; Object.getOwnPropertyNames($).forEach(name => { Object.defineProperty(copy, name, Object.getOwnPropertyDescriptor($, name)!); }); return copy; })()",
    variable:
      "(() => { const copy = {}; const names = Object.getOwnPropertyNames($); for (let index = 0; index < names.length; index++) Object.defineProperty(copy, names[index], Object.getOwnPropertyDescriptor($, names[index])!); return copy; })()",
  },
  "object-create": {
    inline: "Object.create(null, Object.getOwnPropertyDescriptors($))",
    variable:
      "(() => { const descriptors = Object.getOwnPropertyDescriptors($); return Object.create(Object.prototype, descriptors); })()",
  },
  "a-copy-of-the-copy": {
    inline:
      "Object.defineProperties({}, Object.getOwnPropertyDescriptors(Object.defineProperties({}, Object.getOwnPropertyDescriptors($))))",
    variable:
      "(() => { const first = Object.defineProperties({}, Object.getOwnPropertyDescriptors($)); return Object.defineProperties({}, Object.getOwnPropertyDescriptors(first)); })()",
  },
  "object-assign": {
    inline: "Object.assign({}, $)",
    variable: "(() => { const onto = {}; Object.assign(onto, $); return onto; })()",
  },
  "a-spread": {
    inline: "({ ...($ as object) })",
    variable: "(() => { const held: object = $; return { ...held }; })()",
  },
  "a-spread-of-what-was-made-enumerable": {
    inline:
      "(() => { for (const key of Reflect.ownKeys($)) Reflect.defineProperty($, key, { enumerable: true }); return { ...($ as object) }; })()",
    variable:
      "(() => { const held: object = $; for (const key of Reflect.ownKeys(held)) Reflect.defineProperty(held, key, { enumerable: true }); return Object.assign({}, held); })()",
  },
  "its-entries": {
    inline: "Object.fromEntries(Object.entries($))",
    variable: "(() => { const entries = Object.entries($); return Object.fromEntries(entries); })()",
  },
  "structured-clone": {
    inline: "structuredClone($)",
    variable: "(() => { const held = $; return structuredClone(held); })()",
  },
};

const access = (name: string) => (/^[0-9]/.test(name) ? `[${name}]` : `.${name}`);

function textOf(
  sourceName: string,
  source: Source,
  copierName: string,
  copier: Copier,
  route: "inline" | "variable" | "function",
  asked: "by-name" | "under-a-computed-key",
) {
  const words = `${sourceName.replaceAll("-", " ")}, copied by ${copierName.replaceAll("-", " ")}`;
  const form = route === "function" ? copier.inline : copier[route];
  const made =
    route === "function"
      ? `function copyOf(given: any): any { return ${form.replaceAll("$", "given")}; }\nconst copy: any = attempt(() => copyOf(original));`
      : `const copy: any = attempt(() => ${form.replaceAll("$", "original")});`;
  const rows = source.names.flatMap(([name, type, shown], index) => {
    const read = asked === "by-name" ? `copy${access(name)}` : `copy[keys[${index}]]`;
    const show = shown === "type" ? "kindOf" : "textOf";
    if (asked === "under-a-computed-key") {
      return [
        `row("${name} is called if it is there", () => kindOf(${read}?.(0)));`,
        `row("${name} is asked for a member", () => kindOf(${read}?.member));`,
        `row("${name} in a literal", () => { const holder = { member: ${read} }; return ${show}(holder.member); });`,
        `row("${name} in a sum", () => ${shown === "type" || type === "object" ? "kindOf" : "textOf"}(${read} + 1));`,
        `row("${name} in a call", () => ${show}(handOn(${read})));`,
        `row("${name} is the same", () => ${read} === original[keys[${index}]]);`,
      ];
    }
    return [
      `row("${name} in a literal", () => { const holder = { member: ${read} }; return ${show}(holder.member); });`,
      `row("${name} in a variable", () => { const held: ${type} | undefined = ${read}; return ${show}(held); });`,
      `row("${name} in a sum", () => ${shown === "type" || type === "object" ? "kindOf" : "textOf"}(${read} + 1));`,
      `row("${name} in a call", () => ${show}(handOn(${read})));`,
      `row("${name} is the same", () => ${read} === original${access(name)});`,
      `row("${name} is own", () => Object.hasOwn(copy, "${name}") + " " + ("${name}" in copy));`,
    ];
  });
  const keys =
    asked === "by-name"
      ? ""
      : `\nconst keys: string[] = [${source.names.map(([name]) => `"${name}"`).join(", ")}, "other"];`;
  return `// What ${words}, holds under the ${asked === "by-name" ? "names" : "computed keys"} that the original has since it was made${route === "inline" ? "" : route === "variable" ? ": what lies between the calls is in a variable" : ": a function makes the copy"}.
${source.before ?? ""}
function kindOf(value: unknown): string { return typeof value; }
function textOf(value: unknown): string { return typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? "object " + Object.prototype.toString.call(value) : typeof value + " " + String(value); }
function handOn<T>(value: T): T { return value; }
function attempt(make: () => unknown): unknown { try { return make(); } catch (error) { console.log("no copy: " + (error as Error).name); return {}; } }
function row(name: string, read: () => unknown): void { try { console.log(name + ": " + String(read())); } catch (error) { console.log(name + ": THROWS " + (error as Error).name); } }
const original: any = ${source.make};${keys}
${made}
${rows.join("\n")}
row("keys", () => Reflect.ownKeys(copy).map(String).filter(key => key !== "stack" && key !== "line" && key !== "column" && key !== "sourceURL").join(" "));
`;
}

const declaredFields: [name: string, field: string][] = [
  ["boolean", "f: boolean = true;"],
  ["an-integer", "f: number = 1;"],
  ["a-fraction", "f: number = 1.5;"],
  ["string", 'f: string = "s";'],
  ["bigint", "f: bigint = 1n;"],
  ["symbol", "f: symbol = Symbol.iterator;"],
  ["an-object", "f: { a: number } = { a: 1 };"],
  ["a-list", "f: number[] = [1];"],
  ["a-function-or-null", "f: (() => number) | null = () => 1;"],
  ["boolean-or-null", "f: boolean | null = true;"],
  ["number-or-undefined", "f: number | undefined = 1;"],
  ["an-optional-number", "f?: number;"],
  ["any", "f: any = 1;"],
  ["unknown", "f: unknown = 1;"],
  ["one-of-two-texts", 'f: "a" | "b" = "a";'],
  ["an-enum", "f: E = E.One;"],
];

const definedValues = [
  "undefined",
  "null",
  "true",
  "false",
  "0",
  "1",
  "-0",
  "1.5",
  "NaN",
  "2147483648",
  "-2147483649",
  '""',
  '"text"',
  "1n",
  "Symbol.iterator",
  "{ a: 2 }",
  "[2]",
  "() => 2",
];

const plainDescriptor = (value: string) => `{ value: ${value}, writable: true, enumerable: true, configurable: true }`;

const definers: Record<string, (object: string, value: string) => string> = {
  "Object.defineProperty": (object, value) => `Object.defineProperty(${object}, "f", ${plainDescriptor(value)});`,
  "Object.defineProperties": (object, value) => `Object.defineProperties(${object}, { f: ${plainDescriptor(value)} });`,
  "Reflect.defineProperty": (object, value) => `Reflect.defineProperty(${object}, "f", ${plainDescriptor(value)});`,
};

const headOfDeclaredFields = `enum E { Zero = 0, One = 1 }
const out: string[] = [];
function show(x: unknown): string {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "bigint") return x + "n";
  if (typeof x === "symbol" || typeof x === "function") return typeof x;
  if (typeof x === "object" && x !== null) return JSON.stringify(x);
  return typeof x === "string" ? JSON.stringify(x) : String(x);
}
function flags(o: object): string {
  const d = Object.getOwnPropertyDescriptor(o, "f");
  return d ? (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") : "none";
}
`;

function textOfDeclaredField(field: string): string {
  const cases: string[] = [];
  for (const value of definedValues) {
    for (const [definerName, define] of Object.entries(definers)) {
      for (const place of ["straight", "in a loop", "behind a call", "in the constructor"]) {
        const n = cases.length + 1;
        const label = JSON.stringify(`${value} | ${definerName} | ${place}: `);
        const look = `out.push(${label} + [typeof h.f, show(h.f), h.f ? "t" : "f", h.f === undefined, h.f == null, Object.keys(h).join(), flags(h), h.x].join(" "));`;
        const plainClass = `class C${n} { x: number = 1; ${field} }`;
        const body = {
          "straight": `${plainClass}\nfunction run${n}() { const h = new C${n}(); ${define("h", value)} ${look} }`,
          "in a loop": `${plainClass}\nfunction run${n}() { const h = new C${n}(); let held = 0; for (let round = 0; round < 40; round++) { if (round === 36) ${define("h", value)} if (h.f) held++; } out.push("held " + held); ${look} }`,
          "behind a call": `${plainClass}\nfunction change${n}(o: C${n}) { ${define("o", value)} }\nfunction run${n}() { const h = new C${n}(); change${n}(h); ${look} }`,
          "in the constructor": `class C${n} { x: number = 1; ${field} constructor() { ${define("this", value)} } }\nfunction run${n}() { const h = new C${n}(); ${look} }`,
        }[place]!;
        cases.push(`${body}\nrun${n}();`);
      }
    }
  }
  return `${headOfDeclaredFields}${cases.join("\n")}\nconsole.log(out.join("\\n"));\n`;
}

const programsOfDeclaredFields = (): WrittenProgram[] =>
  declaredFields.map(([name, field]) => {
    const entry = `a-field-declared-${name}-is-defined-with-every-kind-of-value.ts`;
    return { entry, files: { [entry]: textOfDeclaredField(field) } };
  });

const programsOfCopies = (): WrittenProgram[] =>
  Object.entries(sources).flatMap(([sourceName, source]) =>
    Object.entries(copiers)
      .filter(([copierName]) => !source.isBuiltIn || copierName !== "a-spread-of-what-was-made-enumerable")
      .flatMap(([copierName, copier]) =>
        (["inline", "variable", "function"] as const)
          .flatMap(route => (["by-name", "under-a-computed-key"] as const).map(asked => ({ route, asked })))
          .map(({ route, asked }) => {
            const name = `what-${sourceName}-holds-since-it-was-made-copied-by-${copierName}-${route}${asked === "by-name" ? "" : `-and-read-${asked}`}`;
            const text = textOf(sourceName, source, copierName, copier, route, asked);
            if (!source.files) return { entry: `${name}.ts`, files: { [`${name}.ts`]: text } };
            return {
              entry: `${name}/main.ts`,
              files: {
                [`${name}/main.ts`]: text,
                ...Object.fromEntries(
                  Object.entries(source.files).map(([file, content]) => [`${name}/${file}`, content]),
                ),
              },
            };
          }),
      ),
  );

export const programs = (): WrittenProgram[] => [...programsOfCopies(), ...programsOfDeclaredFields()];
