// Files that end in `export = value`, and files that import them in every way.
//
//   exported    a function, a class, an object with a method and a getter, a function and a class with a namespace of their names, a namespace, an enum, a number, a variable that changes later,
//               what another file exports
//   imported    `import name = require(..)`, with `type`, with `export` in front; as the default, as a namespace, by the names of members; by `require(..)` and by `import(..)`
//   used        as a value, only as a type, never
//   files       .ts and .cts that export, .ts, .cts and .mts that import
//   read        which files run and in which order, what kind of value arrives, its keys, what it answers, and whether two importers hold the same value
import type { Random } from "./random";

const main = `const lines: string[] = [];
function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name + "{" + Object.keys(value).join(",") + "}";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 2) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  if (value !== null && typeof value === "object") return (Object.prototype.toString.call(value) === "[object Module]" ? "Module" : "") + "{" + Object.keys(value).sort().map(key => key + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return String(value);
}
(globalThis as any).note = (...parts: unknown[]) => void lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
(globalThis as any).held = [];
const note: (...parts: unknown[]) => void = (globalThis as any).note;
`;
const top = `const note: (...parts: unknown[]) => void = (globalThis as any).note;\nconst held: unknown[] = (globalThis as any).held;\n`;

type Leaf = {
  file: string;
  isCalled?: boolean;
  isMade?: boolean;
  hasA?: boolean;
  isType?: boolean;
  isOnlyType?: boolean;
  isPlain?: boolean;
  hasMembers?: boolean;
};

export function generate(random: Random): { text: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const leaves: Leaf[] = [];
  const count = random.between(2, 4);
  for (let id = 0; id < count; id++) {
    const file = `leaf${id}.${random.pick(["ts", "ts", "cts"])}`;
    const earlier = leaves.filter(leaf => !leaf.isOnlyType);
    const [text, about] = random.pick<[string, Omit<Leaf, "file">]>([
      [`export = function named${id}() {\nreturn ${id};\n};`, { isCalled: true, isPlain: true }],
      [`function named${id}() {\nreturn ${id};\n}\nexport = named${id};`, { isCalled: true }],
      [`class Thing${id} {\na = ${id};\nstatic fixed = 1;\n}\nexport = Thing${id};`, { isMade: true, isType: true }],
      [
        `const value = {\na: ${id},\nb() {\nreturn this.a;\n},\nget late() {\nnote("get late of leaf ${id}");\nreturn 1;\n},\n};\nexport = value;`,
        { hasA: true },
      ],
      [
        `function both${id}() {\nreturn ${id};\n}\nnamespace both${id} {\nexport const a = ${id};\nexport type T = number;\n}\nexport = both${id};`,
        { isCalled: true, hasA: true, hasMembers: true },
      ],
      [
        `class Both${id} {\nb = ${id};\n}\nnamespace Both${id} {\nexport const a = ${id};\n}\nexport = Both${id};`,
        { isMade: true, hasA: true, isType: true, hasMembers: true },
      ],
      [
        `namespace Space${id} {\nexport const a = ${id};\nexport let changes = 1;\nexport function step() {\nreturn ++changes;\n}\nexport type T = number;\n}\nexport = Space${id};`,
        { hasA: true, hasMembers: true },
      ],
      [
        `enum Kind${id} {\na = ${id},\nB = "b",\n}\nexport = Kind${id};`,
        { hasA: true, isType: true, hasMembers: true },
      ],
      [`export = ${id};`, { isPlain: true }],
      [
        `let changes = ${id};\nexport = changes;\nchanges++;\nnote("changed in leaf ${id}", changes);`,
        { isPlain: true },
      ],
      [`export = { a: ${id}, default: "a member named default" };`, { hasA: true, isPlain: true }],
      [`export = { a: ${id}, __esModule: true, default: "behind the mark" };`, { hasA: true, isPlain: true }],
      ...(earlier.length
        ? [random.pick(earlier)].map((from): [string, Omit<Leaf, "file">] => [
            `import inner = require("./${from.file}");\nexport = inner;`,
            { ...from },
          ])
        : []),
    ]);
    files[file] = `${top}note("runs leaf ${id}");\n${text}\n`;
    leaves.push({ ...about, file });
  }

  const scenes = random.between(3, 7);
  for (let id = 0; id < scenes; id++) {
    const leaf = random.pick(leaves);
    const from = `"./${leaf.file}"`;
    const extension = random.pick(["ts", "ts", "cts", "mts"]);
    const asValue = (name: string) => [
      `note("holds", typeof ${name}, ${name});`,
      `note("the same as before", held.includes(${name}));\nheld.push(${name});`,
      ...(leaf.isCalled ? [`note("called", (${name} as any)());`] : []),
      ...(leaf.isMade ? [`note("made", new (${name} as any)());`] : []),
      ...(leaf.hasA ? [`note("a", (${name} as any).a);`] : []),
    ];
    const asType = (name: string) =>
      leaf.isType
        ? [`let kept: ${name} | undefined;\nnote("as a type", typeof kept);`]
        : [`let kept: typeof ${name} | undefined;\nnote("under typeof", typeof kept);`];
    const use = (name: string) =>
      leaf.isOnlyType
        ? random.pick([asType(name), []])
        : random.weighted([
            [5, asValue(name)],
            [2, asType(name)],
            [2, [] as string[]],
          ]);
    const isModule = extension !== "cts";
    const rows = random.weighted<string[]>([
      [5, [`import got = require(${from});`, ...use("got")]],
      [1, [`import type got = require(${from});`, ...random.pick([asType("got"), []])]],
      [
        leaf.isOnlyType || leaf.isPlain ? 0 : 2,
        [`export import got = require(${from});`, ...random.pick([asValue("got"), []])],
      ],
      [isModule && !leaf.isOnlyType ? 4 : 0, [`import got from ${from};`, ...use("got")]],
      [
        isModule && !leaf.isOnlyType ? 3 : 0,
        [
          `// @ts-ignore\nimport * as got from ${from};`,
          ...random.pick([[`note("holds", typeof got, got);`, `note("default", (got as any).default);`], []]),
        ],
      ],
      [
        isModule && leaf.hasA ? 3 : 0,
        [`// @ts-ignore\nimport { a } from ${from};`, ...random.pick([[`note("a", a);`], []])],
      ],
      [
        isModule && leaf.hasA ? 1 : 0,
        [`// @ts-ignore\nimport got, { a as renamed } from ${from};`, `note("both", typeof got, renamed);`],
      ],
      [isModule && leaf.hasA ? 1 : 0, [`// @ts-ignore\nexport { a } from ${from};`]],
      [isModule && !leaf.isOnlyType ? 1 : 0, [`// @ts-ignore\nexport * from ${from};`]],
      [isModule && !leaf.isOnlyType ? 1 : 0, [`export { default } from ${from};`]],
      [2, [`declare function require(name: string): any;`, `const got = require(${from});`, ...asValue("got")]],
      [
        isModule ? 2 : 0,
        [`const got: any = await import(${from});`, `note("holds", typeof got, got);`, `note("default", got.default);`],
      ],
    ]);
    files[`scene${id}.${extension}`] = `${top}note("runs scene ${id}");\n${rows.join("\n")}\nexport {};\n`.replace(
      extension === "cts" && rows.some(row => row.startsWith("export import")) ? "export {};\n" : "\u0000",
      "",
    );
  }

  const text =
    main +
    Object.keys(files)
      .filter(file => file.startsWith("scene"))
      .map(
        file =>
          `try {\nnote("${file} exports", await import("./${file}"));\n} catch (error) {\nnote("${file} THROWS", (error as Error).constructor.name);\n}`,
      )
      .join("\n") +
    `\nawait null;\nconsole.log(lines.join("\\n"));\nexport {};\n`;
  files["tsconfig.json"] = JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      esModuleInterop: true,
      noEmit: true,
      strict: true,
      types: [],
    },
  });
  return { text, files };
}
