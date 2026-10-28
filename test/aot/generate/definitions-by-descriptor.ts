// The programs of definitions-by-descriptor that are one text but for a few places: an object of each kind is copied in each way, and the copy is asked for what the object holds since it was made.
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
) {
  const words = `${sourceName.replaceAll("-", " ")}, copied by ${copierName.replaceAll("-", " ")}`;
  const form = route === "function" ? copier.inline : copier[route];
  const made =
    route === "function"
      ? `function copyOf(given: any): any { return ${form.replaceAll("$", "given")}; }\nconst copy: any = attempt(() => copyOf(original));`
      : `const copy: any = attempt(() => ${form.replaceAll("$", "original")});`;
  const rows = source.names.flatMap(([name, type, shown]) => {
    const read = `copy${access(name)}`;
    const show = shown === "type" ? "kindOf" : "textOf";
    return [
      `row("${name} in a literal", () => { const holder = { member: ${read} }; return ${show}(holder.member); });`,
      `row("${name} in a variable", () => { const held: ${type} | undefined = ${read}; return ${show}(held); });`,
      `row("${name} in a sum", () => ${shown === "type" || type === "object" ? "kindOf" : "textOf"}(${read} + 1));`,
      `row("${name} in a call", () => ${show}(handOn(${read})));`,
      `row("${name} is the same", () => ${read} === original${access(name)});`,
      `row("${name} is own", () => Object.hasOwn(copy, "${name}") + " " + ("${name}" in copy));`,
    ];
  });
  return `// What ${words}, holds under the names that the original has since it was made${route === "inline" ? "" : route === "variable" ? ": what lies between the calls is in a variable" : ": a function makes the copy"}.
${source.before ?? ""}
function kindOf(value: unknown): string { return typeof value; }
function textOf(value: unknown): string { return typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? "object " + Object.prototype.toString.call(value) : typeof value + " " + String(value); }
function handOn<T>(value: T): T { return value; }
function attempt(make: () => unknown): unknown { try { return make(); } catch (error) { console.log("no copy: " + (error as Error).name); return {}; } }
function row(name: string, read: () => unknown): void { try { console.log(name + ": " + String(read())); } catch (error) { console.log(name + ": THROWS " + (error as Error).name); } }
const original: any = ${source.make};
${made}
${rows.join("\n")}
row("keys", () => Reflect.ownKeys(copy).map(String).filter(key => key !== "stack" && key !== "line" && key !== "column" && key !== "sourceURL").join(" "));
`;
}

export const programs = (): WrittenProgram[] =>
  Object.entries(sources).flatMap(([sourceName, source]) =>
    Object.entries(copiers)
      .filter(([copierName]) => !source.isBuiltIn || copierName !== "a-spread-of-what-was-made-enumerable")
      .flatMap(([copierName, copier]) =>
        (["inline", "variable", "function"] as const).map(route => {
          const name = `what-${sourceName}-holds-since-it-was-made-copied-by-${copierName}-${route}`;
          const text = textOf(sourceName, source, copierName, copier, route);
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
