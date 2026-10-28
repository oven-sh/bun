// Classes whose members carry decorators, and what the program sees of them afterwards.
//
//   decorators  one that only looks, one that puts something else in the member's place, one that adds an initializer, one that keeps the way to the member for later,
//               one that throws, one that answers with what no decorator may answer with; one, two or three on a member
//   spelled     a call, a name, a member of an object, a call of one, an expression in parentheses
//   members     fields, methods, getters, setters, pairs of both, accessors; of the instance or static; public, private, under a computed key; and the class itself
//   classes     a declaration or an expression, alone or below another decorated class, with static blocks and a constructor between the members
//   read        the order in which keys, decorators, initializers and static blocks run; the keys and attributes of the class, its prototype and its instances;
//               what each member answers, once and in a loop
//
// `isLegacy` writes the decorators of TypeScript's `experimentalDecorators`, which get the prototype, the key and the descriptor, and may stand on parameters.
// There the key expression of a decorated member has no effect that shows how often it runs. With `emitsMetadata` the members have types of every kind, and the program's own
// `Reflect.metadata` prints what stands for each type when the program runs.
import type { Random } from "./random";

const head = `const lines: string[] = [];
const calls: Record<string, number> = {};
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
function counted(name: string): void {
  calls[name] = (calls[name] ?? 0) + 1;
}
function key<T extends string>(name: T): T {
  note("key", name);
  return name;
}
function quiet<T extends string>(name: T): T {
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

const standard = `const ways: [string, any][] = [];
function looks(name: string): any {
  note("made", name);
  return (value: any, context: any) => {
    note("applied", name, context.kind, context.name, context.static, context.private, typeof value, typeof context.addInitializer);
  };
}
function replaces(name: string): any {
  note("made", name);
  return (value: any, context: any) => {
    note("applied", name, context.kind);
    switch (context.kind) {
      case "method":
        return function (this: any, ...given: any[]) {
          counted(name);
          return value.apply(this, given) + 1;
        };
      case "getter":
        return function (this: any) {
          counted(name);
          return value.call(this) + 1;
        };
      case "setter":
        return function (this: any, next: any) {
          counted(name);
          value.call(this, next + 1);
        };
      case "field":
        return function (this: any, first: any) {
          counted(name);
          return typeof first === "number" ? first + 10 : [name, first];
        };
      case "accessor":
        return {
          get(this: any) {
            counted(name);
            return value.get.call(this) + 1;
          },
          set(this: any, next: any) {
            value.set.call(this, next + 1);
          },
          init(first: any) {
            return first + 100;
          },
        };
      case "class":
        return class extends value {
          replacedBy = name;
        };
    }
  };
}
function begins(name: string): any {
  note("made", name);
  return (_value: any, context: any) => {
    note("applied", name, context.kind);
    context.addInitializer(function (this: any) {
      counted(name);
      if (calls[name] < 3) note("begins", name, typeof this === "function" ? "a class" : Reflect.ownKeys(this));
    });
  };
}
function remembers(name: string): any {
  note("made", name);
  return (_value: any, context: any) => {
    note("applied", name, context.kind, context.access ? Object.keys(context.access) : "no way");
    if (context.access) ways.push([name, context.access]);
  };
}
function fails(name: string): any {
  note("made", name);
  return () => {
    throw new RangeError("fails " + name);
  };
}
function answersBadly(name: string): any {
  note("made", name);
  return () => 1;
}
const plainly: any = looks("plainly");
const table: any = { looks, replaces, begins, inner: { plainly, remembers } };
function alongTheWays(holder: any): void {
  for (const [name, way] of ways) {
    attempt("has " + name, () => way.has(holder));
    if (way.get) attempt("get " + name, () => way.get(holder));
    if (way.set) attempt("set " + name, () => way.set(holder, 7));
    if (way.get) attempt("get again " + name, () => way.get(holder));
  }
}
`;

const legacy = `function where(target: any): string {
  return typeof target === "function" ? "the class " + target.name : "the prototype of " + target.constructor.name;
}
function looks(name: string): any {
  note("made", name);
  return (...given: any[]) => {
    note("applied", name, given.length, where(given[0]), given[1], typeof given[2] === "object" && given[2] !== null ? attributes({ member: 0, ...given[2] }) : given[2]);
  };
}
function replaces(name: string): any {
  note("made", name);
  return (target: any, member?: any, found?: any) => {
    note("applied", name);
    if (member === undefined && found === undefined)
      return class extends target {
        replacedBy = name;
      };
    if (typeof found === "number") return;
    if (!found) {
      Object.defineProperty(target, member, {
        get() {
          counted(name);
          return name;
        },
        set(next: any) {
          Object.defineProperty(this, member, { value: [name, next], writable: true, configurable: true, enumerable: true });
        },
        configurable: true,
      });
      return;
    }
    const { value, get, set } = found;
    if (value)
      found.value = function (this: any, ...given: any[]) {
        counted(name);
        return value.apply(this, given) + 1;
      };
    if (get)
      found.get = function (this: any) {
        counted(name);
        return get.call(this) + 1;
      };
    if (set)
      found.set = function (this: any, next: any) {
        set.call(this, next + 1);
      };
    return name.length & 1 ? found : undefined;
  };
}
function begins(name: string): any {
  note("made", name);
  return (target: any, member?: any) => {
    note("applied", name);
    (target.marks ??= []).push([name, member]);
  };
}
function remembers(name: string): any {
  note("made", name);
  return (target: any, member?: any, found?: any) => {
    note("applied", name, typeof found);
    if (found && typeof found === "object") return { ...found, enumerable: true };
  };
}
function fails(name: string): any {
  note("made", name);
  return () => {
    throw new RangeError("fails " + name);
  };
}
function answersBadly(name: string): any {
  note("made", name);
  return () => 1;
}
const plainly: any = looks("plainly");
const table: any = { looks, replaces, begins, inner: { plainly, remembers } };
function alongTheWays(holder: any): void {
  note("marks", holder.marks, holder.constructor.marks);
}
`;

const metadata = `(Reflect as any).metadata = (about: string, value: unknown) => (target: any, member?: any) => {
  note("metadata", about, typeof value === "function" ? value.name : Array.isArray(value) ? value.map(each => (typeof each === "function" ? each.name : each)) : value, where(target), member);
};
`;

const declared = `enum Numbers {
  One = 1,
  Two,
}
enum Texts {
  A = "a",
  B = "b",
}
enum Mixed {
  One = 1,
  A = "a",
}
const enum Folded {
  One = 1,
}
interface Shape {
  a: number;
}
type Alias = number;
type Either = "a" | "b";
type Maker = new () => Earlier;
class Earlier {
  a = 1;
}
namespace Space {
  export class Inside {}
  export type Hollow = string;
}
`;

const types = [
  "number",
  "string",
  "boolean",
  "bigint",
  "symbol",
  "any",
  "unknown",
  "void",
  "null",
  "undefined",
  "never",
  "object",
  "Function",
  "() => void",
  "number[]",
  "Array<string>",
  "[number, string]",
  "readonly number[]",
  "Date",
  "RegExp",
  "Error",
  "Map<string, number>",
  "Set<Earlier>",
  "Promise<number>",
  "Uint8Array",
  "Either",
  '"a"',
  "1 | 2",
  "1",
  "true",
  "1n",
  "`a${string}`",
  "number | string",
  "number | undefined",
  "string | null",
  "Earlier | undefined",
  "Earlier | null",
  "Earlier | Date",
  "Earlier & Shape",
  "Numbers",
  "Texts",
  "Mixed",
  "Folded",
  "Numbers.One",
  "Numbers | undefined",
  "Earlier",
  "Later",
  "Shape",
  "Alias",
  "Maker",
  "Space.Inside",
  "Space.Hollow",
  "typeof origin",
  "typeof Earlier",
  "keyof Shape",
  'Shape["a"]',
  "Partial<Shape>",
  "{ a: number }",
  "unique symbol",
  "this",
  "Object",
  "Number",
  "String",
  "Boolean",
  "Symbol",
  "BigInt",
  "Record<string, number>",
  "NonNullable<string | null>",
  "ReturnType<typeof quiet>",
  "InstanceType<typeof Earlier>",
] as const;

type Member = {
  text: (marks: string) => string;
  uses: string[];
  isPrivate?: true;
  isAccessor?: true;
  takesParameters?: true;
  needsAParent?: true;
};

export function generate(random: Random, isLegacy: boolean, emitsMetadata = false): string {
  let names = 0;
  const kinds = ["looks", "looks", "replaces", "replaces", "begins", "remembers"] as const;
  // One in twelve classes has a decorator that ends the definition.
  const marks = (about: string, mayEnd: boolean, between: string) =>
    Array.from(
      {
        length: random.weighted([
          [2, 0],
          [6, 1],
          [3, 2],
          [1, 3],
        ] as const),
      },
      () => {
        const kind =
          mayEnd && random.chance(0.03) ? random.pick(["fails", "answersBadly"] as const) : random.pick(kinds);
        const name = `"${about} ${++names}"`;
        if (kind === "looks" && random.chance(0.15))
          return `@${random.pick(["plainly", "table.inner.plainly", "(plainly)", "(origin ? plainly : table.inner.plainly)"])}${between}`;
        if (kind !== "fails" && kind !== "answersBadly" && random.chance(0.2))
          return `@${kind === "remembers" ? "table.inner.remembers" : `table.${kind}`}(${name})${between}`;
        return `@${random.chance(0.1) ? `(${kind}(${name}))` : `${kind}(${name})`}${between}`;
      },
    ).join("");
  const type = (mayBeThis: boolean) => {
    const drawn = random.pick(types);
    return drawn === "unique symbol" || (drawn === "this" && !mayBeThis) ? "symbol" : drawn;
  };

  const members = (id: number, isStatic: boolean, hasAParent: boolean): Member[] => {
    const on = isStatic ? "C" : "made";
    const word = isStatic ? "static " : "";
    const n = (name: string) => `${name}${id}${isStatic ? "s" : ""}`;
    const all: Member[] = [
      {
        text: m => `${m}${word}${n("field")} = ${random.pick(["1", '"text"', "{ a: 1 }", "[1, 2]", "origin + 1"])};`,
        uses: [`${on}.${n("field")}`],
      },
      {
        text: m => `${m}${word}${n("bare")}: any;`,
        uses: [`${on}.${n("bare")}`, `Object.hasOwn(${on}, "${n("bare")}")`],
      },
      {
        text: m => `${m}${word}${n("arrow")} = () => ${isLegacy && isStatic ? "origin" : "this === undefined"};`,
        uses: [`${on}.${n("arrow")}()`],
      },
      {
        text: m => `${m}${word}${n("method")}(a: number, b = 2) {\nreturn a + b;\n}`,
        uses: [`${on}.${n("method")}(1)`, `${on}.${n("method")}.name`, `${on}.${n("method")}.length`],
        takesParameters: true,
      },
      {
        text: m =>
          `${m}${word}[${isLegacy ? random.pick([`quiet("${n("computed")}")`, `"${n("computed")}"`, `\`${n("computed")}\``]) : `key("${n("computed")}")`}]() {\nreturn 5;\n}`,
        uses: [`${on}.${n("computed")}()`, `${on}.${n("computed")}.name`],
      },
      { text: m => `${m}${word}get ${n("getter")}() {\nreturn 3;\n}`, uses: [`${on}.${n("getter")}`] },
      {
        text: m =>
          `${word}${n("kept")} = 0;\n${m}${word}set ${n("setter")}(next: number) {\nthis.${n("kept")} = next;\n}`,
        uses: [`(${on}.${n("setter")} = 4, ${on}.${n("kept")})`],
      },
      {
        text: m =>
          `${word}${n("behind")} = 1;\n${m}${word}get ${n("pair")}() {\nreturn this.${n("behind")};\n}\n${isLegacy ? "" : marksOfSecond()}${word}set ${n("pair")}(next: number) {\nthis.${n("behind")} = next * 2;\n}`,
        uses: [`${on}.${n("pair")}`, `(${on}.${n("pair")} = 4, ${on}.${n("pair")})`],
      },
      { text: m => `${m}${word}async ${n("waits")}() {\nreturn 6;\n}`, uses: [`typeof ${on}.${n("waits")}().then`] },
      { text: m => `${m}${word}*${n("yields")}() {\nyield 7;\n}`, uses: [`typeof ${on}.${n("yields")}`] },
      {
        text: m => `${m}${word}accessor ${n("stored")} = 8;`,
        uses: [`${on}.${n("stored")}`, `(${on}.${n("stored")} = 9, ${on}.${n("stored")})`],
        isAccessor: true,
      },
      {
        text: m => `${m}${word}#${n("hidden")} = 10;\n${word}${n("showsHidden")}() {\nreturn this.#${n("hidden")};\n}`,
        uses: [`${on}.${n("showsHidden")}()`],
        isPrivate: true,
      },
      {
        text: m =>
          `${m}${word}#${n("secret")}() {\nreturn 11;\n}\n${word}${n("callsSecret")}() {\nreturn this.#${n("secret")}();\n}`,
        uses: [`${on}.${n("callsSecret")}()`],
        isPrivate: true,
      },
      {
        text: m =>
          `${m}${word}get #${n("veiled")}() {\nreturn 12;\n}\n${word}${n("readsVeiled")}() {\nreturn this.#${n("veiled")};\n}`,
        uses: [`${on}.${n("readsVeiled")}()`],
        isPrivate: true,
      },
      {
        text: m =>
          `${m}${word}accessor #${n("sealed")} = 13;\n${word}${n("readsSealed")}() {\nreturn (this.#${n("sealed")} = this.#${n("sealed")} + 1);\n}`,
        uses: [`${on}.${n("readsSealed")}()`, `${on}.${n("readsSealed")}()`],
        isPrivate: true,
        isAccessor: true,
      },
      {
        text: m =>
          `${m}${word}${n("names")}() {\nreturn typeof SELF === "function" && (SELF as any) === ${isStatic ? "this" : "(this as any).constructor"};\n}`,
        uses: [`${on}.${n("names")}()`],
      },
      {
        text: m => `${m}${word}${n("above")}() {\nreturn typeof super.toString;\n}`,
        uses: [`${on}.${n("above")}()`],
        needsAParent: true,
      },
      { text: m => `${m}${word}${n("optional")}?: number;`, uses: [`Object.hasOwn(${on}, "${n("optional")}")`] },
      { text: m => `${m}${word}readonly ${n("fixed")}: number = 14;`, uses: [`${on}.${n("fixed")}`] },
    ];
    if (emitsMetadata)
      all.push(
        {
          text: m =>
            `${m}${word}${n("typed")}${isStatic ? "" : "!"}: ${type(!isStatic)}${isStatic ? " = undefined as never" : ""};`,
          uses: [`Object.hasOwn(${on}, "${n("typed")}")`],
        },
        {
          text: m =>
            `${m}${word}${n("alsoTyped")}${isStatic ? "" : "!"}: ${type(!isStatic)}${isStatic ? " = undefined as never" : ""};`,
          uses: [],
        },
        {
          text: m =>
            `${m}${word}${n("typedMethod")}(a: ${type(false)}, b?: ${type(false)}, ...rest: ${random.pick(["number[]", "Earlier[]", "any[]"])}): ${type(!isStatic)} {\nreturn undefined as never;\n}`,
          uses: [`${on}.${n("typedMethod")}.length`],
        },
        {
          text: m => `${m}${word}get ${n("typedGetter")}(): ${type(!isStatic)} {\nreturn undefined as never;\n}`,
          uses: [],
        },
        { text: m => `${m}${word}set ${n("typedSetter")}(next: ${type(false)}) {}`, uses: [] },
      );
    return all.filter(
      member => (hasAParent || !member.needsAParent) && !(isLegacy && (member.isPrivate || member.isAccessor)),
    );
  };
  let marksOfSecond = () => "";

  const parts: string[] = [head, isLegacy ? legacy : standard];
  if (isLegacy && emitsMetadata) parts.push(metadata, declared);
  const classes = random.between(1, 3);
  for (let id = 0; id < classes; id++) {
    const mayEnd = random.chance(0.3);
    marksOfSecond = () => marks(`second ${id}`, mayEnd, "\n");
    const parent = id > 0 && random.chance(0.5) ? `defined${id - 1} ?? Object` : undefined;
    const body: string[] = [];
    const uses: string[] = [];
    const classMarks = marks(`class ${id}`, mayEnd, "\n");
    // TypeScript allows the older decorators in a class declaration alone.
    const isExpression = !isLegacy && !classMarks && random.chance(0.3);
    const self = isExpression ? `Named${id}` : `C${id}`;
    const chosen = random.shuffled([
      ...random.sample(members(id, false, !!parent), random.between(1, 6)),
      ...random.sample(members(id, true, !!parent), random.between(0, 3)),
    ]);
    for (const member of chosen) {
      let text = member
        .text(marks(`member ${id}`, mayEnd, random.chance(0.3) ? " " : "\n"))
        .replaceAll("SELF", () => self);
      if (isLegacy && member.takesParameters && random.chance(0.6))
        text = text.replace("(a: number", `(${marks(`parameter ${id}`, false, " ")}a: number`);
      body.push(text);
      uses.push(...member.uses);
      if (random.chance(0.15))
        body.push(`static {\nnote("static block"${isLegacy ? "" : ", Reflect.ownKeys(this)"});\n}`);
    }
    const constructor =
      emitsMetadata || random.chance(0.6)
        ? `constructor(${isLegacy && random.chance(0.4) ? marks(`parameter ${id}`, false, " ") : ""}${random.chance(0.3) ? "public " : ""}start: number${emitsMetadata && random.chance(0.6) ? `, second?: ${type(false)}, third?: ${type(false)}` : ""}) {\n${parent ? "super(start);\n" : ""}note("constructor ${id}", Reflect.ownKeys(this));\n}`
        : undefined;
    body.splice(random.below(body.length + 1), 0, ...(constructor ? [constructor] : []));
    parts.push(
      [
        `function define${id}(): any {`,
        `try {`,
        isExpression
          ? `const C = class Named${id}${parent ? ` extends (${parent})` : ""} {`
          : `${classMarks}class C${id}${parent ? ` extends (${parent})` : ""} {`,
        ...body,
        isExpression ? `};` : `}`,
        `note("defined ${id}");`,
        `return ${isExpression ? "C" : `C${id}`};`,
        `} catch (error) {`,
        `note("the definition ${id} threw", (error as Error).constructor.name, (error as Error).message.startsWith("fails") ? (error as Error).message : "");`,
        `}`,
        `}`,
        `const defined${id} = define${id}();`,
        `if (defined${id}) {`,
        `const C: any = defined${id};`,
        `note("name", C.name, C.length);`,
        `note("class", attributes(C));`,
        `note("prototype", attributes(C.prototype));`,
        `attempt("made", () => {`,
        `const made = new C(1);`,
        `note("instance", attributes(made));`,
        ...uses.map(use => `attempt(${JSON.stringify(use)}, () => ${use});`),
        `alongTheWays(made);`,
        `return Reflect.ownKeys(made).length;`,
        `});`,
        random.chance(0.5)
          ? `attempt("many", () => {\nlet sum = 0;\nfor (let turn = 0; turn < ${random.pick([3, 300])}; turn++) {\nconst made = new C(turn);\nsum += Reflect.ownKeys(made).length${uses
              .filter(use => /\.(method|getter|computed|callsSecret|readsVeiled)\d+s?(\(1?\))?$/.test(use))
              .map(use => ` + ${use}`)
              .join("")};\n}\nreturn sum;\n});`
          : ``,
        `}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  parts.splice(2, 0, `const origin = 40;`);
  if (isLegacy && emitsMetadata) parts.push(`class Later {}\nnote("later", Later);`);
  parts.push(`note("calls", calls);\nconsole.log(lines.slice(0, 900).join("\\n"));\nconsole.log(lines.length);`);
  return parts.join("\n") + "\n";
}
