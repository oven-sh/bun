// Classes written with what only TypeScript has, and what the program sees of them when it runs.
//
//   parameters  parameter properties under every modifier, beside plain parameters, patterns and a rest; with defaults that tell when they run, read earlier parameters or close over them;
//               statements ahead of `super(..)`, parameters assigned in the body, a constructor that returns another object, signatures of overloads ahead of the constructor
//   fields      with and without a value, `?`, `!`, `declare`, `readonly`, `static`, under computed, quoted and numeric keys; `accessor` fields, public, private and static
//               a key in brackets calls a function, or is a literal in parentheses or under a cast, a sum, a template, a number with a sign, or a constant that the file declares first
//   only types  abstract classes and members, signatures of overloads of methods and functions, optional methods, index signatures, a `this` parameter, `implements`, type parameters, `declare` of every kind
//   below       one to three classes below each other, with names of their own or with the same names, so that a field meets an accessor, a setter or a parameter property of the class above
//   read        the order in which defaults, keys, values, static blocks and constructors run; the keys and attributes of the class, its prototype and its instances; what each member answers
//
// `useDefineForClassFields` decides whether a field is defined or assigned, and whether a field without a value exists.
import type { Random } from "./random";

export const options = ["defines", "assigns"] as const;
export type Option = (typeof options)[number];

export const tsconfig = (option: Option) =>
  JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      noEmit: true,
      strict: true,
      useDefineForClassFields: option === "defines",
      types: [],
    },
  });

const head = `const lines: string[] = [];
function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell<T>(label: string, value: T): T {
  note("runs", label);
  return value;
}
function key<T extends string>(name: T): T {
  note("key", name);
  return name;
}
function attributes(holder: unknown): string {
  if ((typeof holder !== "object" && typeof holder !== "function") || holder === null) return "no object: " + show(holder);
  return Reflect.ownKeys(holder)
    .map(name => {
      const found = Reflect.getOwnPropertyDescriptor(holder, name)!;
      return String(name) + ":" + ("value" in found ? "v" : (found.get ? "g" : "") + (found.set ? "s" : "")) + (found.writable ? "w" : "") + (found.enumerable ? "e" : "") + (found.configurable ? "c" : "");
    })
    .join(" ");
}
function attempt(label: string, run: () => unknown): void {
  try {
    note(label, run());
  } catch (error) {
    note(label, "THROWS", (error as Error).constructor.name);
  }
}
`;

const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
const modifiers = [
  "public",
  "private",
  "protected",
  "readonly",
  "public readonly",
  "private readonly",
  "protected readonly",
];
const values = ["1", "-0", '"text"', "null", "undefined", "[1, 2]", "{ inner: 1 }", "1.5", "() => 1", "2 ** 31"];

type Owed = { name: string; kind: "method" | "field" | "getter" };

function classes(random: Random, id: number): string[] {
  const rows: string[] = [];
  const levels = random.between(1, 3);
  // With names of their own the classes stand below each other as they are; with the same names the class above is `any`, so that TypeScript lets a member stand for one of another kind.
  const sharesNames = random.chance(0.5);
  let owed: Owed[] = [];
  const called = new Set<string>();
  const stored = new Set<string>();
  for (let level = 0; level < levels; level++) {
    const name = `C${id}_${level}`;
    const above = level ? `C${id}_${level - 1}` : undefined;
    const free = random.shuffled(letters).map(letter => (sharesNames ? letter : letter + level));
    const isAbstract = level < levels - 1 && random.chance(0.4);
    const isExpression = !isAbstract && random.chance(0.25);
    const body: string[] = [];
    const told = (member: string) => `tell("${name}.${member}", ${random.pick(values)})`;
    const other = () => random.pick(letters) + (sharesNames ? "" : random.below(level + 1));
    const inBrackets = (member: string) =>
      random.weighted([
        [4, `key("${member}")`],
        [2, `named_${member}`],
        [1, `("${member}")`],
        [1, `"${member}" as string`],
        [1, `"" + "${member}"`],
        [1, `\`\${"${member}"}\``],
        [1, `true && "${member}"`],
        [1, `(0, "${member}")`],
      ]);
    const value = (member: string) =>
      random.weighted([
        [4, told(member)],
        [2, `tell("${name}.${member}", (this as any).${other()})`],
        [1, random.pick(values)],
      ]);

    for (const { name: member, kind } of owed) {
      const at = free.indexOf(member);
      if (at >= 0) free.splice(at, 1);
      if (kind === "method") body.push(`${member}() {\nreturn "${name}.${member}";\n}`);
      else if (kind === "field") body.push(`${member}: unknown = ${told(member)};`);
      else body.push(`get ${member}(): unknown {\nreturn "${name}.${member}";\n}`);
      (kind === "method" ? called : stored).add(member);
    }
    owed = [];

    for (let count = random.between(2, 6); count > 0 && free.length > 4; count--) {
      const member = free.pop()!;
      const visible = random.pick(["", "", "", "public ", "protected ", "private ", "readonly "]);
      const kind = random.weighted([
        [5, "field"],
        [3, "bare"],
        [2, "declared"],
        [3, "static"],
        [2, "computed"],
        [1, "spelled"],
        [5, "accessor"],
        [3, "method"],
        [2, "overloads"],
        [1, "optional method"],
        [2, "pair"],
        [1, "setter"],
        [isAbstract ? 5 : 0, "abstract"],
        [1, "index"],
        [3, "block"],
        [isExpression ? 0 : 1, "this parameter"],
        [1, "private"],
      ] as const);
      if (kind === "field") body.push(`${visible}${member}: unknown = ${value(member)};`);
      else if (kind === "bare") body.push(`${visible}${member}${random.pick(["", "?", "!"])}: unknown;`);
      else if (kind === "declared") body.push(`declare ${visible}${member}: unknown;`);
      else if (kind === "static")
        body.push(
          random.pick([
            `static ${member}: unknown = tell("static ${name}.${member}", ${random.pick([...values, "this.name", "attributes(this)", "typeof this"])});`,
            `static ${member}: unknown;`,
            `declare static ${member}: unknown;`,
            `static accessor ${member}: unknown = tell("static accessor ${name}.${member}", ${random.pick(values)});`,
            `static readonly ${member} = tell("static ${name}.${member}", ${random.pick(values)});`,
          ]),
        );
      else if (kind === "computed")
        body.push(
          random.pick([
            `// @ts-ignore\n[${inBrackets(member)}]: unknown = ${value(member)};`,
            `// @ts-ignore\nstatic [${inBrackets(member)}]: unknown = ${told(member)};`,
            `// @ts-ignore\naccessor [${inBrackets(member)}]: unknown = ${value(member)};`,
            `// @ts-ignore\n[${inBrackets(member)}]: unknown;`,
            `// @ts-ignore\n[${inBrackets(member)}]() {\nreturn "${name}.${member}";\n}`,
          ]),
        );
      else if (kind === "spelled")
        body.push(
          random.pick([
            `"${member} ${member}": unknown = ${value(member)};`,
            `${level + 1}${free.length}: unknown = ${value(member)};`,
            `[${random.pick(["-", "+"])}${level + 1}${free.length}]: unknown = ${value(member)};`,
            `"${member}": unknown;`,
          ]),
        );
      else if (kind === "accessor")
        body.push(
          random.pick([
            `${visible.replace("readonly ", "")}accessor ${member}: unknown = ${value(member)};`,
            `${visible.replace("readonly ", "")}accessor ${member}: unknown = ${value(member)};`,
            `accessor ${member}: unknown;`,
            `accessor #${member}: unknown = ${value("#" + member)};\nget ${member}() {\nreturn this.#${member};\n}\nset ${member}(given: unknown) {\nthis.#${member} = given;\n}`,
          ]),
        );
      else if (kind === "method") {
        body.push(
          `${visible.replace("readonly ", "")}${member}(given?: unknown) {\nreturn ["${name}.${member}", given${above && sharesNames ? `, typeof super.${member}` : ""}];\n}`,
        );
        called.add(member);
      } else if (kind === "overloads") {
        const kindOfMethod = random.pick(["", "static ", "async ", "*"]);
        const signature = kindOfMethod === "*" || kindOfMethod === "async " ? "" : kindOfMethod;
        const answers = kindOfMethod === "async " ? "Promise<any>" : "any";
        body.push(
          `${signature}${member}(): ${answers};\n${signature}${member}(given: number): ${answers};\n${signature}${member}(given: string, more: number): ${answers};\n${kindOfMethod}${member}(given?: unknown, more?: unknown): ${answers} {\nreturn ["${name}.${member}", given, more];\n}`,
        );
        if (kindOfMethod === "") called.add(member);
      } else if (kind === "optional method") body.push(`${member}?(): void;`);
      else if (kind === "pair")
        body.push(
          `get ${member}(): unknown {\nnote("get ${name}.${member}");\nreturn "${name}.${member}";\n}\nset ${member}(given: unknown) {\nnote("set ${name}.${member}", given);\n}`,
        );
      else if (kind === "setter")
        body.push(`set ${member}(given: unknown) {\nnote("set ${name}.${member}", given);\n}`);
      else if (kind === "abstract") {
        const what = random.pick(["method", "field", "getter"] as const);
        body.push(
          what === "method"
            ? `abstract ${member}(): unknown;`
            : what === "field"
              ? `abstract ${member}: unknown;`
              : `abstract get ${member}(): unknown;`,
        );
        if (!sharesNames) owed.push({ name: member, kind: what });
      } else if (kind === "index") {
        if (!body.some(row => row.startsWith("[name: string]"))) body.push(`[name: string]: unknown;`);
      } else if (kind === "block")
        body.push(
          `static {\nnote("static block of ${name}", ${random.pick(["this.name", "attributes(this)", isExpression ? "typeof this" : "this === " + name, above ? "Object.getPrototypeOf(this).name" : "typeof this", "this.length"])});\n${random.chance(0.4) ? `(this as any).${member} = tell("${name}.${member} in a block", ${random.pick(values)});\n` : ""}}`,
        );
      else if (kind === "this parameter") {
        body.push(
          `${member}(this: ${name}, given?: unknown) {\nreturn ["${name}.${member}", given, this instanceof ${name}];\n}`,
        );
        called.add(member);
      } else
        body.push(
          `#${member}: unknown = ${value("#" + member)};\nstatic has${member}${level}(given: object) {\nreturn #${member} in given;\n}\nread${member}${level}() {\nreturn this.#${member};\n}`,
        );
      if (["field", "bare", "declared", "accessor", "pair", "setter"].includes(kind)) stored.add(member);
    }

    if (random.chance(0.85)) {
      const parameters: string[] = [];
      const names: string[] = [];
      const properties: string[] = [];
      // Where no class stands above, the values of `accessor` fields and the defaults of the parameters run in an order of their own: there the defaults do not tell when they run, and no parameter is a pattern, which throws for `null`.
      const tells = !!above || !body.some(row => /^(?!static )(\/\/ @ts-ignore\n)?(\w+ )*accessor /.test(row));
      const mayTell = (label: string, value: string) => (tells ? `tell("${label}", ${value})` : value);
      for (let count = random.between(0, 4); count > 0 && free.length; count--) {
        const parameter = free.pop()!;
        const isProperty = random.chance(0.7);
        const earlier = names.length ? random.pick(names) : undefined;
        const initial = random.weighted([
          [3, `: unknown = ${mayTell(`default of ${name}.${parameter}`, random.pick(values))}`],
          [3, `?: unknown`],
          [earlier ? 2 : 0, `: unknown = ${earlier}`],
          [earlier ? 2 : 0, `: unknown = () => ${earlier}`],
          [1, `: unknown = () => ${parameter}`],
          [1, `: unknown = arguments.length`],
        ]);
        parameters.push(`${isProperty ? random.pick(modifiers) + " " : ""}${parameter}${initial}`);
        names.push(parameter);
        if (isProperty) {
          properties.push(parameter);
          stored.add(parameter);
        }
      }
      if (tells && random.chance(0.15)) parameters.push(`{ p, q = tell("default of q in ${name}", 1) }: any = {}`);
      if (random.chance(0.2)) parameters.push(`...rest: unknown[]`);
      const statements: string[] = [];
      if (above) {
        if (random.chance(0.4))
          statements.push(`note("ahead of super in ${name}"${names.length ? ", " + random.pick(names) : ""});`);
        if (random.chance(0.2) && names.length) statements.push(`${random.pick(names)} = "assigned ahead of super";`);
        statements.push(
          `// @ts-ignore\nsuper(${random.pick(["", names.join(", "), names.slice().reverse().join(", "), `tell("argument of super in ${name}", 7)`, "...(arguments as any)"])});`,
        );
      }
      statements.push(`note("in ${name}", attributes(this));`);
      if (names.length && random.chance(0.5)) {
        const changed = random.pick(names);
        statements.push(
          `${changed} = "assigned";`,
          `note("assigned in ${name}", ${changed}, (this as any).${changed});`,
        );
      }
      for (const property of properties)
        if (random.chance(0.3))
          statements.push(
            `note("called", typeof this.${property} === "function" ? (this.${property} as any)() : this.${property});`,
          );
      if (random.chance(0.1)) statements.push(`return { from: "${name}" } as any;`);
      if (random.chance(0.25)) body.push(`constructor();\nconstructor(...given: any[]);`);
      const at = random.below(body.length + 1);
      const overloads = body[body.length - 1]?.startsWith("constructor();") ? body.pop()! + "\n" : "";
      body.splice(
        Math.min(at, body.length),
        0,
        `${overloads}constructor(${parameters.join(", ")}) {\n${statements.join("\n")}\n}`,
      );
    }

    const generic = random.chance(0.2) ? "<T = unknown>" : "";
    const base = above ? ` extends ${sharesNames ? `(${above} as any)` : above}` : "";
    const follows = random.chance(0.2) ? ` implements Shape${id}` : "";
    const opening = isExpression
      ? `const ${name} = class${random.pick(["", " Inner"])}${generic}${base}${follows} {`
      : `${isAbstract ? "abstract " : ""}class ${name}${generic}${base}${follows} {`;
    rows.push(`${opening}\n${body.join("\n")}\n}${isExpression ? ";" : ""}`);
  }

  const leaf = `C${id}_${levels - 1}`;
  for (let level = 0; level < levels; level++) {
    const name = `C${id}_${level}`;
    rows.push(
      `note("${name}", ${name}.name, ${name}.length, "|", attributes(${name}), "|", attributes(${name}.prototype));`,
    );
  }
  const reads: string[] = [`note("made", attributes(made), "|", made, "|", JSON.stringify(made));`];
  for (const member of called) reads.push(`attempt("call ${member}", () => made.${member}(turn));`);
  for (const member of stored)
    reads.push(
      `attempt("read ${member}", () => made.${member});`,
      `attempt("store ${member}", () => ((made.${member} = turn), made.${member}));`,
    );
  reads.push(`note("then", attributes(made));`);
  rows.push(
    `for (const [turn, given] of [[], [1], [undefined, "two", 3, 4, 5], [null, undefined]].entries())\nattempt("new ${leaf} " + turn, () => {\nconst made: any = new (${random.chance(0.15) ? `C${id}_0` : leaf} as any)(...given);\n${reads.join("\n")}\nreturn "over";\n});`,
  );
  return [`interface Shape${id} {}`, ...rows];
}

function onlyTypes(random: Random, id: number): string[] {
  const name = `over${id}`;
  const forms: string[][] = [
    [
      `attempt("ahead", () => ${name}(1));`,
      `function ${name}(): unknown;\nfunction ${name}(given: number): unknown;\nfunction ${name}(given: string, more: number): unknown;\nfunction ${name}(given?: unknown, more?: unknown) {\nreturn ["${name}", given, more, arguments.length];\n}`,
      `note(${name}.name, ${name}.length, ${name}(), ${name}("text", 2));`,
    ],
    [
      `declare function ghost${id}(): void;`,
      `attempt("a declared function", () => typeof ghost${id});`,
      `attempt("called", () => ghost${id}());`,
    ],
    [
      `declare const ghost${id}: number;`,
      `attempt("a declared constant", () => typeof ghost${id});`,
      `attempt("read", () => ghost${id});`,
    ],
    [
      `declare let ghost${id}: number;`,
      `attempt("a declared variable", () => typeof ghost${id});`,
      `attempt("stored", () => (ghost${id} = 1));`,
    ],
    [
      `declare class Ghost${id} {\na: number;\n}`,
      `attempt("a declared class", () => typeof Ghost${id});`,
      `attempt("made", () => new Ghost${id}());`,
    ],
    [
      `declare namespace Ghost${id} {\nconst a: number;\n}`,
      `attempt("a declared namespace", () => typeof Ghost${id});`,
      `attempt("read", () => Ghost${id}.a);`,
    ],
    [
      `declare enum Ghost${id} {\nA,\n}`,
      `attempt("a declared enum", () => typeof Ghost${id});`,
      `attempt("read", () => Ghost${id}.A);`,
    ],
    [
      `namespace Space${id} {\nexport function ${name}(): unknown;\nexport function ${name}(given: number): unknown;\nexport function ${name}(given?: unknown) {\nreturn ["${name}", given];\n}\n}`,
      `note(attributes(Space${id}), Space${id}.${name}(1), Space${id}.${name}.length);`,
    ],
    [
      `function holds${id}() {\nattempt("ahead", () => inner(1));\nfunction inner(): unknown;\nfunction inner(given: number): unknown;\nfunction inner(given?: unknown) {\nreturn ["inner", given];\n}\nreturn inner;\n}`,
      `note(holds${id}()(), holds${id}().length);`,
    ],
    [
      `const held${id} = {\n${name}(this: { a: number }, given: number) {\nreturn [this.a, given];\n},\na: ${id},\n};`,
      `note(held${id}.${name}.length, held${id}.${name}(1));`,
    ],
    [
      `function ${name}(this: unknown, given?: number) {\nreturn [typeof this, given, arguments.length];\n}`,
      `note(${name}.length, ${name}.call(1, 2), ${name}.call(undefined));`,
    ],
    [
      `abstract class Above${id} {\nabstract made(): unknown;\nfirst = tell("Above${id}.first", this.made());\n}`,
      `class Below${id} extends Above${id} {\nsecond = tell("Below${id}.second", 2);\nmade() {\nreturn this.second;\n}\n}`,
      `note(new Below${id}(), attributes(Above${id}.prototype));`,
      `attempt("an abstract class made", () => new (Above${id} as any)());`,
    ],
  ];
  return random.pick(forms);
}

export function generate(random: Random, option: Option): { text: string; files: Record<string, string> } {
  const rows: string[] = [];
  for (let id = 0, scenes = random.between(2, 5); id < scenes; id++) {
    const scene = random.chance(0.75) ? classes(random, id) : onlyTypes(random, id);
    // A scene stands at the top of the file, in a block or in a function that is called twice.
    const place = random.weighted([
      [4, "top"],
      [1, "block"],
      [2, "function"],
    ] as const);
    const mayMove = !scene.some(row => /^(declare|namespace|interface) /.test(row) && !row.startsWith("interface"));
    if (place === "top" || !mayMove) rows.push(...scene);
    else if (place === "block") rows.push(`{\n${scene.join("\n")}\n}`);
    else
      rows.push(
        `function scene${id}(outer: number) {\nnote("scene ${id}", outer);\n${scene.join("\n")}\n}\nscene${id}(1);\nscene${id}(2);`,
      );
  }
  const body = rows.join("\n");
  const named = [...new Set(body.match(/\bnamed_\w+/g))].map(name => `${name} = "${name.slice("named_".length)}"`);
  const constants = named.length ? `const ${named.join(", ")};\n` : "";
  return {
    text: `${constants}${head}${body}\nconsole.log(lines.join("\\n"));\nexport {};\n`,
    files: { "tsconfig.json": tsconfig(option) },
  };
}
