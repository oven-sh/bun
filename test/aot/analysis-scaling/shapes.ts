export type Shape = {
  name: string;
  counted: string;
  sizes: number[];
  instructionsPerItem: number;
  bytesPerItem: number;
  write(count: number): Record<string, string>;
  /** What it costs today where that is more than allowed: the shape is listed as a todo. */
  notYet?: string;
};

function unionOfGenericClasses(methods: number, functions: number) {
  const variants = ["First", "Second"];
  const method = (variant: string, index: number) =>
    [
      `  map${index}<A>(f: (value: T) => A): Either<A, E> { return new ${variant}<A, E>(f(this.held as T)); }`,
      `  mapError${index}<F>(f: (error: E) => F): Either<T, F> { return new ${variant}<T, F>(f(this.held as E)); }`,
      `  then${index}<U, F>(f: (value: T) => Either<U, F>): Either<U, E | F> { return f(this.held as T); }`,
    ][index % 3];
  const classes = variants.map(
    variant => `export class ${variant}<T, E> {\n  constructor(readonly held: T | E) {}\n${Array.from({ length: methods }, (_, index) => method(variant, index)).join("\n")}\n}`,
  );
  const makers = Array.from({ length: functions }, (_, index) => `export function make${index}(n: number): Either<number, string> { return new ${variants[index % 2]}<number, string>(n + ${index}); }`);
  return `export type Either<T, E> = ${variants.map(variant => `${variant}<T, E>`).join(" | ")};\n${classes.join("\n")}\n${makers.join("\n")}\n`;
}

function declaredInterfaceOverConditionalTypes(properties: number) {
  const indexes = Array.from({ length: properties }, (_, index) => index);
  let deepType = "number";
  let deepValue = "1";
  for (let depth = 0; depth < 10; depth++) {
    deepType = `Box<${deepType}>`;
    deepValue = `{ held: ${deepValue} }`;
  }
  return {
    "node_modules/chain/package.json": `{ "name": "chain", "version": "1.0.0", "type": "module", "main": "index.js", "types": "index.d.ts" }\n`,
    "node_modules/chain/index.js": `export function inspect(value) {\n  return { value };\n}\n`,
    "node_modules/chain/index.d.ts": `${indexes.map(index => `export type Unwrap${index}<T> = T extends { p${index}: infer P } ? P : never;\n`).join("")}export interface Chain<T> {\n  value: T;\n${indexes.map(index => `  p${index}: Chain<Unwrap${index}<T>>;\n`).join("")}}\nexport declare function inspect<T>(value: T): Chain<T>;\n`,
    "main.ts": `import { inspect } from "chain";\ntype Box<T> = { held: T };\nconst deep: ${deepType} = ${deepValue};\nexport const kind = typeof inspect(deep).value;\n`,
  };
}

function genericWrapperUsedFromJavaScript(methods: number) {
  const puts = Array.from({ length: methods }, (_, index) => `  put${index}<Inner extends T>(next: Inner | Held<Inner>): void { this.value = next instanceof Wrapper ? next.value : next; }\n`);
  return {
    "model.ts": `export type Held<T extends object> = Wrapper<T> | (Wrapper<T> & { readonly tag: T });\nexport class Wrapper<T extends object> {\n  constructor(public value: T) {}\n${puts.join("")}}\nexport function make(): Wrapper<{ id: number }> { return new Wrapper({ id: 1 }); }\n`,
    "use.js": `import { make } from "./model.ts";\nexport function read() { return make().value.id; }\n`,
    "main.ts": `import { read } from "./use.js";\nconsole.log(read());\n`,
  };
}

function builderHandedOutAsInterface(methods: number) {
  const indexes = Array.from({ length: methods }, (_, index) => index);
  return `type Code = "BAD" | "WORSE" | (string & {});
interface Item { message?: string }
type Entries = { [key in Code]?: Item };
type Merged<First extends Entries, Second extends Entries> = keyof First extends never | keyof Second ? Second : Omit<First, keyof Second> & Second;
interface Definition<Input, Known extends Entries> { input?: { type: Input }; known: Known }
interface Plugin<Input, Known extends Entries> { marker?: { type: Known }; input?: { type: Input }; name: string }
interface Narrow<Ctx extends object, Extra extends object, Input, Known extends Entries> {
  definition: Definition<Input, Known>;
  meta(...plugins: Plugin<Input, Known>[]): Narrow<Ctx, Extra, Input, Known>;
${indexes.map(index => `  errors${index}<T extends Entries>(errors: T): Narrow<Ctx, Extra, Input, Merged<Known, T>>;\n`).join("")}}
class Wide<Ctx extends object, Known extends Entries> {
  definition: Definition<void, Known>;
  constructor(definition: Definition<void, Known>) { this.definition = definition; }
  meta(...plugins: Plugin<void, Known>[]): Wide<Ctx, Known> { return plugins.length > 99 ? new Wide(this.definition) : this; }
${indexes.map(index => `  errors${index}<U extends Entries>(errors: U): Wide<Ctx, Merged<Known, U>> { return new Wide({ known: { ...this.definition.known, ...errors } }) as any; }\n`).join("")}  input<Input>(schema: Input): Narrow<Ctx, object, Input, Known> { const builder = new Wide({ ...this.definition }); return builder as any; }
}
console.log(typeof new Wide<object, {}>({ known: {} }).input(1));
`;
}

function castsToDeferredRecursiveTypes(functions: number) {
  const indexes = Array.from({ length: functions }, (_, index) => index);
  return `type Tree = { left?: Tree; right?: Tree; value?: number };
${indexes
  .map(
    index => `type Walk${index}<Node, Path extends unknown[]> = Node extends { left?: infer Left; right?: infer Right } ? Walk${index}<Left, [...Path, ${index}]> | Walk${index}<Right, [...Path, "r"]> : Path["length"];
export function parse${index}<const Shape extends Tree>(content: unknown) { return content as Walk${index}<Shape, []>; }
`,
  )
  .join("")}console.log(${indexes.map(index => `typeof parse${index}`).join(" + ") || '""'});
`;
}

function builderInterfacesReturningOneAnother(steps: number) {
  const indexes = Array.from({ length: steps }, (_, index) => index);
  const uses = (result: string, extra: string) =>
    indexes.map(index => `  use${index}<Out extends Bag, In extends Bag = MergedBag<Start, Added>>(step: (bag: In) => Out): ${result}<MergedStart<Start, Added, In>, MergedBag<Added, Out>${extra}>;\n`).join("");
  return `type Bag = { [key: PropertyKey]: any };
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type MergedStart<Start extends Bag, Out extends Bag, In extends Bag> = In extends any ? (Exclude<keyof In, keyof Start | keyof Out> extends never ? Start : Start & OmitEach<In, keyof Start | keyof Out>) : never;
type MergedBag<Current extends Bag, Out extends Bag> = keyof Out extends never ? Current : OmitEach<Current, keyof Out> & Out;
interface Middle<Start extends Bag, Added extends Bag> {
${uses("Middle", "")}  input<Input>(schema: Input): Narrow<Start, Added, Input>;
}
interface Narrow<Start extends Bag, Added extends Bag, Input> {
  schema: Input;
${uses("Narrow", ", Input")}}
class Wide<Start extends Bag> {
  schema: unknown = undefined;
${indexes.map(index => `  use${index}<Out extends Bag, In extends Bag = Start>(step: (bag: In) => Out): Middle<MergedStart<Start, object, In>, Out> { return (step.length > 9 ? this : new Wide()) as any; }\n`).join("")}  input<Input>(schema: Input): Narrow<Start, object, Input> { const builder = new Wide(); builder.schema = schema; return builder as any; }
}
console.log(typeof new Wide<{}>().input(1).schema);
`;
}

function genericBuilderEnteringUnionWithAnotherClass(methods: number) {
  const indexes = Array.from({ length: methods }, (_, index) => index);
  return `class Router {
  routes: string[] = [];
${indexes.map(index => `  m${index}(path: string): Router { this.routes.push(path); return this; }\n`).join("")}  fetch(request: string): string { return request + this.routes.length; }
}
class Builder<Routes> {
  constructor(readonly held: Routes) {}
${indexes.map(index => `  m${index}(path: string): Builder<Routes & { r${index}: string }> { return new Builder({ ...this.held, r${index}: path }); }\n`).join("")}  fetch(request: string): string { return request + Object.keys(this.held as object).length; }
}
function mount(input: ((request: string) => string) | { fetch(request: string): string } | Router): string {
  return typeof input === "function" ? input("f") : input.fetch("o");
}
export const mounted = mount(new Builder({})) + mount(new Router());
`;
}

function arrayFilledWithSumsOfItsOwnElements(pushes: number) {
  const indexes = Array.from({ length: pushes }, (_, index) => index);
  return `const parts = [];\nparts.push("a");\n${indexes.map(index => `parts.push(parts[${index}] + parts[${index + 1}]);\n`).join("")}console.log(parts.length);\n`;
}

function twoArraysFilledWithSumsOfEachOthersElements(pushes: number) {
  const indexes = Array.from({ length: pushes }, (_, index) => index);
  return `const left = [];\nconst right = [];\nleft.push("a");\nright.push("b");\n${indexes.map(index => `left.push(right[${index}] + "x");\nright.push(left[${index}] + "y");\n`).join("")}console.log(left.length + right.length);\n`;
}

function arrowsInTheDefaultsOfEachOthersParameters(levels: number) {
  return `function f(x: any): any { return ${"(a = ".repeat(levels)}x${") => a".repeat(levels)}; }\nconsole.log(typeof f);\n`;
}

export const shapes: Shape[] = [
  {
    name: "arrow functions in the defaults of each other's parameters",
    counted: "levels",
    sizes: [500, 1000, 2000],
    instructionsPerItem: 2_500_000,
    bytesPerItem: 32 * 1024,
    write: count => ({ "main.ts": arrowsInTheDefaultsOfEachOthersParameters(count) }),
  },
  {
    name: "array filled with sums of its own elements",
    counted: "pushes",
    sizes: [1, 100, 200, 400],
    instructionsPerItem: 1_500_000,
    bytesPerItem: 256 * 1024,
    write: count => ({ "main.ts": arrayFilledWithSumsOfItsOwnElements(count) }),
  },
  {
    name: "two arrays filled with sums of each other's elements",
    counted: "pushes into each",
    sizes: [1, 100, 200, 400],
    instructionsPerItem: 3_000_000,
    bytesPerItem: 256 * 1024,
    write: count => ({ "main.ts": twoArraysFilledWithSumsOfEachOthersElements(count) }),
  },
  {
    name: "generic builder entering a union with another class",
    counted: "methods of the same names in both classes",
    sizes: [8, 12, 16],
    instructionsPerItem: 10_000_000,
    bytesPerItem: 1024 * 1024,
    write: count => ({ "main.ts": genericBuilderEnteringUnionWithAnotherClass(count) }),
  },
  {
    name: "builder interfaces that return one another",
    counted: "methods that merge two context arguments",
    sizes: [4, 8, 16],
    instructionsPerItem: 20_000_000,
    bytesPerItem: 1024 * 1024,
    write: count => ({ "main.ts": builderInterfacesReturningOneAnother(count) }),
  },
  {
    name: "casts to a recursive conditional type of a type parameter",
    counted: "functions with such a cast",
    sizes: [1, 2, 4],
    instructionsPerItem: 250_000_000,
    bytesPerItem: 8 * 1024 * 1024,
    write: count => ({ "main.ts": castsToDeferredRecursiveTypes(count) }),
  },
  {
    name: "builder class handed out as an interface",
    counted: "methods that wrap one type argument once more",
    sizes: [6, 12, 18],
    instructionsPerItem: 12_000_000,
    bytesPerItem: 1024 * 1024,
    write: count => ({ "main.ts": builderHandedOutAsInterface(count) }),
  },
  {
    name: "generic class used from an untyped file",
    counted: "generic methods that mention the class applied to their own type parameter",
    sizes: [1, 4, 16],
    instructionsPerItem: 10_000_000,
    bytesPerItem: 1024 * 1024,
    write: genericWrapperUsedFromJavaScript,
  },
  {
    name: "union of generic classes with generic methods",
    counted: "methods of each class",
    sizes: [1, 2, 4],
    instructionsPerItem: 40_000_000,
    bytesPerItem: 4 * 1024 * 1024,
    write: count => ({ "main.ts": unionOfGenericClasses(count, 1) }),
  },
  {
    name: "functions returning a generic class as a union",
    counted: "functions",
    sizes: [4, 16, 64],
    instructionsPerItem: 10_000_000,
    bytesPerItem: 1024 * 1024,
    write: count => ({ "main.ts": unionOfGenericClasses(2, 1 + count) }),
  },
  {
    name: "exported functions that load under a parameter",
    counted: "functions",
    sizes: [4_000, 16_000],
    instructionsPerItem: 250_000,
    bytesPerItem: 16 * 1024,
    write: count => ({
      "main.ts": `import "./helpers.cjs";\n`,
      // One more than is counted: what the first such function costs, the library behind require() among it, is no cost of an item.
      "helpers.cjs": Array.from({ length: count + 1 }, (_, index) => `function load${index}(name) { return require(name); }\nexports.load${index} = load${index};\n`).join(""),
    }),
  },
  {
    name: "a file whose path an object holds that is spread into itself",
    counted: "assignments",
    sizes: [1_000, 4_000],
    instructionsPerItem: 500_000,
    bytesPerItem: 32 * 1024,
    write: count => ({
      "main.ts": `import "./helpers.cjs";\n`,
      "helpers.cjs": `const fs = require("fs"), path = require("path");\nlet options = { file: path.join(__dirname, "a.txt") };\n${Array.from({ length: count + 1 }, (_, index) => `exports.set${index} = more => { options = { ...options, ...more }; };\n`).join("")}exports.load = () => fs.readFileSync(options.file, "utf8");\n`,
    }),
  },
  {
    name: "a file whose path a field holds that other classes have too",
    counted: "classes",
    sizes: [1_000, 4_000],
    instructionsPerItem: 1_000_000,
    bytesPerItem: 64 * 1024,
    write: count => ({
      "main.ts": `import "./helpers.cjs";\n`,
      "helpers.cjs": `const fs = require("fs"), path = require("path");\n${Array.from({ length: count + 1 }, (_, index) => `exports.Store${index} = class { set(folder) { this.file = path.join(__dirname, folder + ".txt"); } load() { return fs.readFileSync(this.file, "utf8"); } };\n`).join("")}`,
    }),
  },
  {
    name: "a file whose path a property holds that is joined onto itself",
    counted: "assignments",
    sizes: [1_000, 4_000],
    instructionsPerItem: 3_000_000,
    bytesPerItem: 32 * 1024,
    write: count => ({
      "main.ts": `import "./helpers.cjs";\n`,
      "helpers.cjs": `const fs = require("fs"), path = require("path");\nconst options = { folder: __dirname };\n${Array.from({ length: count + 1 }, (_, index) => `if (process.env.MADE_UP_${index}) options.folder = path.join(options.folder, "x${index}");\n`).join("")}exports.load = () => fs.readFileSync(path.join(options.folder, "a.txt"), "utf8");\n`,
    }),
  },
  {
    name: "a module whose folder a property holds that is joined onto itself or kept",
    counted: "assignments",
    sizes: [1_000, 4_000],
    instructionsPerItem: 3_000_000,
    bytesPerItem: 32 * 1024,
    write: count => ({
      "main.ts": `import "./helpers.cjs";\n`,
      "helpers.cjs": `const path = require("path");\nconst options = { folder: __dirname };\n${Array.from({ length: count + 1 }, (_, index) => `options.folder = process.env.MADE_UP_${index} ? path.join(options.folder, "x${index}") : options.folder;\n`).join("")}exports.load = () => require(path.join(options.folder, "a.cjs"));\n`,
    }),
  },
  {
    name: "declared interface recursing through conditional types",
    counted: "properties",
    sizes: [1, 2, 3, 12],
    instructionsPerItem: 10_000_000,
    bytesPerItem: 1024 * 1024,
    write: declaredInterfaceOverConditionalTypes,
  },
];
