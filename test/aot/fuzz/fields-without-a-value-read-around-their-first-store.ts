// Fields of classes that are written without a value, and what the program reads in them before anything is stored, between the stores and after them.
//
//   fields   static and of instances; `accessor` fields, private names, private `accessor` fields and ordinary names; beside them the same fields with a value
//   types    numbers, booleans, texts, bigints, symbols, enums, objects, lists, functions, unions, `unknown`, `any`, or none: then the checker takes the type from the stores in static blocks and constructors
//   stores   out of static blocks and constructors through `this` and through the name of the class, out of methods, other classes, classes below, from outside; `??=`, `||=`, `+=`, `++`;
//            now and then a value that the type does not name
//   reads    through methods that run between the members, so ahead of the definition, ahead of the first store and behind it: the value, its `typeof`, tests, arithmetic, typed variables and parameters, loops
//   first    decorators that see the first value and hand it on or replace it
//   places   at the top of the file, in a block, as an expression, in a function that is called twice, in a loop
import type { Random } from "./random";

export const options = ["strict", "assigns", "loose", "legacy"] as const;
export type Option = (typeof options)[number];

export const tsconfig = (option: Option) =>
  JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      noEmit: true,
      strict: option !== "loose",
      strictPropertyInitialization: false,
      useDefineForClassFields: option !== "assigns",
      experimentalDecorators: option === "legacy",
      types: [],
    },
  });

const head = `const lines: string[] = [];
function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function attempt(label: string, run: () => unknown): void {
  try {
    note(label, run());
  } catch (error) {
    note(label, "THROWS", (error as Error).constructor.name);
  }
}
function attributes(holder: object): string {
  return Reflect.ownKeys(holder)
    .map(name => {
      const found = Reflect.getOwnPropertyDescriptor(holder, name)!;
      return String(name) + ":" + ("value" in found ? "v" : (found.get ? "g" : "") + (found.set ? "s" : "")) + (found.writable ? "w" : "") + (found.enumerable ? "e" : "") + (found.configurable ? "c" : "");
    })
    .join(" ");
}
class Point {
  constructor(public n: number) {}
  twice() {
    return this.n * 2;
  }
}
enum Color {
  Red,
  Green,
  Blue,
}
enum Word {
  Yes = "yes",
  No = "no",
}
function seven() {
  return 7;
}
function double(given: number) {
  return given * 2;
}
function negate(given: boolean) {
  return !given;
}
function shout(given: string) {
  return given + "!";
}
function keep<T>(given: T): T[] {
  return [given];
}
function firstOfAccessor(label: string, ...replacement: unknown[]) {
  return function (_target: ClassAccessorDecoratorTarget<any, any>, context: ClassAccessorDecoratorContext<any, any>): ClassAccessorDecoratorResult<any, any> {
    note("decorates", label, context.kind, String(context.name), context.static, context.private);
    return {
      init(value: unknown) {
        note("the first value of", label, value);
        return replacement.length ? replacement[0] : value;
      },
    };
  };
}
function firstOfField(label: string, ...replacement: unknown[]) {
  return function (_target: undefined, context: ClassFieldDecoratorContext<any, any>) {
    note("decorates", label, context.kind, String(context.name), context.static, context.private);
    return function (value: unknown): any {
      note("the first value of", label, value);
      return replacement.length ? replacement[0] : value;
    };
  };
}
function legacy(label: string) {
  return function (target: any, key: string | symbol, described?: PropertyDescriptor): void {
    note("decorates", label, typeof target, String(key), described === undefined ? "nothing described" : Object.keys(described).join());
  };
}
`;

// `isInferred`: what the checker takes from a store of one of the values is the type itself.
type Kind = { type: string; isInferred?: true; values: string[]; others: string[]; uses: string[]; changes?: string[] };

// `$` stands for the read.
const kinds: Kind[] = [
  {
    type: "number",
    isInferred: true,
    values: ["1", "2.5", "-0", "4294967296", "NaN", "-7"],
    others: [`"other"`, "true", "null"],
    uses: [
      "$ + 1",
      "$ | 0",
      "$ * 2",
      "-$",
      "$ > 0",
      "Math.floor($)",
      "double($)",
      "$.toFixed(1)",
      "$ % 2",
      "[$].includes(NaN)",
    ],
    changes: ["$ += 1", "$++", "--$", "$ *= 2", "$ |= 4"],
  },
  { type: "1 | 2", values: ["1", "2"], others: ["3", `"1"`], uses: ["$ + 1", "$ === 1", "double($)"] },
  {
    type: "boolean",
    isInferred: true,
    values: ["true", "false"],
    others: ["0", `""`, "null"],
    uses: ["$ === false", `$ && "yes"`, "Number($)", `$ ? "yes" : "no"`, "negate($)", "$ === !$"],
  },
  {
    type: "string",
    isInferred: true,
    values: [`"text"`, `""`, `"7"`],
    others: ["7", "false"],
    uses: ["$.length", `$ + "!"`, "$.toUpperCase()", `$ === ""`, "shout($)"],
    changes: [`$ += "more"`],
  },
  {
    type: "bigint",
    isInferred: true,
    values: ["3n", "-1n", "18446744073709551616n"],
    others: ["3", `"3"`],
    uses: ["$ + 1n", "$ * 2n", "$ === 3n", "$ > 0n"],
    changes: ["$ += 1n", "$++"],
  },
  {
    type: "symbol",
    values: ["Symbol.iterator", `Symbol.for("kept")`],
    others: [`"iterator"`],
    uses: ["$.description", "$ === Symbol.iterator"],
  },
  {
    type: "Color",
    isInferred: true,
    values: ["Color.Red", "Color.Blue"],
    others: [`"Red"`, "2.5"],
    uses: ["$ + 1", "Color[$]", "$ === Color.Red", "double($)"],
  },
  {
    type: "Word",
    isInferred: true,
    values: ["Word.Yes", "Word.No"],
    others: ["1"],
    uses: ["$.length", "$ === Word.Yes", "shout($)"],
  },
  {
    type: "Point",
    isInferred: true,
    values: ["new Point(1)", "new Point(2.5)"],
    others: ["{ n: 3 }", "4"],
    uses: ["$.n", "$ instanceof Point", "$.twice()"],
  },
  {
    type: "number[]",
    values: ["[1, 2]", "[]", "[0.5]"],
    others: [`["a"]`, "5"],
    uses: ["$.length", "$[0]", "$.map(double)"],
  },
  {
    type: "() => number",
    isInferred: true,
    values: ["() => 7", "seven"],
    others: ["7"],
    uses: ["$()", "$.name", "$.length"],
  },
  {
    type: "number | string",
    values: ["1", `"one"`],
    others: ["true"],
    uses: [`typeof $ === "number"`, `$ + "!"`, "$ === 1"],
  },
  {
    type: "number | undefined",
    values: ["1", "undefined", "0.5"],
    others: ["null", `"one"`],
    uses: ["($ ?? 0) + 1", "$ === 1"],
  },
  { type: "number | null", values: ["1", "null"], others: [`"one"`], uses: ["$ === null", "($ ?? 0) + 1"] },
  {
    type: "unknown",
    values: ["1", `"text"`, "null", "undefined", "new Point(3)"],
    others: [],
    uses: [`typeof $ === "number" && $ + 1`],
  },
  { type: "any", values: ["1", `"text"`, "null", "new Point(3)"], others: [], uses: ["$ + 1", "$?.n"] },
];

const usesOfAnything = [
  "$",
  "typeof $",
  "$ === undefined",
  "$ == null",
  `$ ?? "nothing"`,
  "String($)",
  "[$]",
  "({ held: $ })",
  "!$",
  "keep($)",
];

const forms = ["accessor", "private accessor", "private", "ordinary"] as const;

type Member = {
  isStatic: boolean;
  form: (typeof forms)[number];
  name: string;
  kind: Kind;
  isTyped: boolean;
  value: string | undefined;
  decorator: string;
};

const isPrivate = (member: Member) => member.form.startsWith("private");
const written = (member: Member) => (isPrivate(member) ? "#" : "") + member.name;

function declaration(member: Member): string {
  const words = [member.isStatic ? "static " : "", member.form.endsWith("accessor") ? "accessor " : ""].join("");
  const type = member.isTyped ? `: ${member.kind.type}` : "";
  const value = member.value === undefined ? "" : ` = ${member.value}`;
  return `${member.decorator}${words}${written(member)}${type}${value};`;
}

function decorator(random: Random, option: Option, member: Member, label: string): string {
  if (!random.chance(0.2)) return "";
  if (option === "legacy") return isPrivate(member) ? "" : `@legacy("${label}") `;
  const replacement = random.chance(0.4) ? `, ${random.pick(member.kind.values)}` : "";
  return `@${member.form.endsWith("accessor") ? "firstOfAccessor" : "firstOfField"}("${label}"${replacement}) `;
}

function looks(random: Random, members: Member[], holder: string): string[] {
  const rows: string[] = [];
  for (const member of members) {
    const read = `${holder}.${written(member)}`;
    // What the checker takes from the stores may name `undefined` too.
    const asItsKind = member.isTyped ? read : `${read}!`;
    const row = (use: string, read: string) =>
      `attempt(label + " ${written(member)} ${use.replaceAll(`"`, "'")}", () => ${use.replaceAll("$", read)});`;
    // The text of a function is not what this is about.
    const uses = usesOfAnything.filter(use => use !== "String($)" || member.kind.type !== "() => number");
    rows.push(...random.sample(uses, random.between(2, 5)).map(use => row(use, read)));
    rows.push(...random.sample(member.kind.uses, random.between(1, 4)).map(use => row(use, asItsKind)));
    if (random.chance(0.4)) {
      rows.push(
        `attempt(label + " ${written(member)} in a typed variable", () => {\nconst held: ${member.kind.type} = ${asItsKind};\nreturn [held, typeof held];\n});`,
      );
    }
    if (member.kind.type === "number" && random.chance(0.4)) {
      rows.push(
        `attempt(label + " ${written(member)} in a loop", () => {\nlet sum = 0;\nfor (let turn = 0; turn < 300; turn++) sum += ${asItsKind};\nreturn sum;\n});`,
      );
    }
  }
  return rows;
}

function store(random: Random, member: Member, holder: string, mayBeAnother: boolean): string {
  const target = `${holder}.${written(member)}`;
  const value = random.pick(member.kind.values);
  if (mayBeAnother && member.kind.others.length && random.chance(0.12)) {
    return `(${holder} as any).${member.name} = ${random.pick(member.kind.others)};`;
  }
  // A private name under a decorator is stored to with `=` alone.
  if (member.decorator && isPrivate(member)) return `${target} = ${value};`;
  const change =
    member.isTyped && member.kind.changes && random.chance(0.25) ? random.pick(member.kind.changes) : undefined;
  if (change)
    return `attempt("${written(member)} ${change.replaceAll(`"`, "'")}", () => ${change.replaceAll("$", target)});`;
  return random.weighted([
    [6, `${target} = ${value};`],
    [1, `${target} ??= ${value};`],
    [1, `${target} ||= ${value};`],
  ] as const);
}

function classes(random: Random, option: Option, id: number): { rows: string[]; isExpression: boolean } {
  const inner = `C${id}`;
  const isExpression = random.chance(0.2);
  const outer = isExpression ? `K${id}` : inner;
  const members: Member[] = [];
  for (let index = 0, count = random.between(2, 6); index < count; index++) {
    const isStatic = random.chance(0.7);
    const member: Member = {
      isStatic,
      // `accessor` is drawn where decorators are the standard ones.
      form: random.pick(option === "legacy" ? forms.filter(form => !form.endsWith("accessor")) : forms),
      // A static block is part of the code around its class, so for the checker `this.name = ..` in one class is a store to `this.name` of the next.
      name: `m${id}${index}`,
      kind: random.weighted([
        [3, kinds[0]],
        [2, kinds[2]],
        [6, random.pick(kinds)],
      ] as const),
      isTyped: true,
      value: undefined,
      decorator: "",
    };
    if (random.chance(0.2)) member.value = random.pick(member.kind.values);
    member.isTyped = !member.kind.isInferred || !random.chance(0.4);
    // An experimental decorator stands in no class expression.
    if (option !== "legacy" || !isExpression)
      member.decorator = decorator(random, option, member, `${inner}.${written(member)}`);
    members.push(member);
  }
  const body: string[] = [];
  const later: string[] = [];
  for (const isStatic of [true, false]) {
    const side = members.filter(member => member.isStatic === isStatic);
    if (!side.length) continue;
    const word = isStatic ? "static " : "";
    const holder = isStatic ? random.pick([inner, "this"]) : "this";
    body.push(`${word}look(label: string) {\n${looks(random, side, holder).join("\n")}\nreturn label;\n}`);
    for (const member of side) {
      body.push(`${word}store${member.name}(given: ${member.kind.type}) {\n${holder}.${written(member)} = given;\n}`);
    }
    const stores: string[] = [];
    let seen = 0;
    const look = () =>
      `${word}seen${seen} = ${isStatic ? inner : "this"}.look("${isStatic ? inner : "an instance"} at ${seen++}");`;
    if (random.chance(0.5)) body.push(look());
    for (const member of random.shuffled(side)) {
      body.push(declaration(member));
      if (random.chance(0.6)) body.push(look());
      // Without a written type the checker takes the type from what `this.name = ..` stores in a static block or in the constructor.
      const first = `this.${written(member)} = ${random.pick(member.kind.values.filter(value => value !== "undefined" && value !== "null"))};`;
      const rows =
        member.isTyped && random.chance(0.25) ? [] : [member.isTyped ? store(random, member, "this", false) : first];
      if (member.isTyped && random.chance(0.3)) rows.push(store(random, member, isStatic ? inner : "this", false));
      if (random.chance(0.3))
        rows.push(`${isStatic ? inner : "this"}.store${member.name}(${random.pick(member.kind.values)});`);
      if (!isStatic) stores.push(...rows);
      else if (rows.length) {
        body.push(`static {\n${rows.join("\n")}\n}`);
        if (random.chance(0.5)) body.push(look());
      }
    }
    if (!isStatic) {
      body.push(
        `constructor() {\nthis.look("ahead of the stores");\n${stores.join("\n")}\nthis.look("behind the stores");\n}`,
      );
    }
    const from = isStatic ? outer : `made${id}`;
    if (!isStatic) later.push(`const ${from} = new ${outer}();`);
    later.push(`${from}.look("from outside");`, `note(attributes(${from}));`);
    for (const member of side) {
      if (random.chance(0.5)) {
        later.push(
          isPrivate(member)
            ? `${from}.store${member.name}(${random.pick(member.kind.values)});`
            : store(random, member, from, true),
        );
      }
      if (isStatic && !isPrivate(member) && random.chance(0.3)) {
        const value = random.pick(member.kind.values);
        later.push(
          random.pick([
            `class Other${id}${member.name} {\nstatic {\n${from}.${member.name} = ${value};\n}\n}`,
            `class Below${id}${member.name} extends ${from} {\nstatic {\nattempt("stored through the class below", () => (Below${id}${member.name}.${member.name} = ${value}));\nattempt("read through the class below", () => Below${id}${member.name}.${member.name});\nattempt("stored through super", () => (super.${member.name} = ${value}));\nattempt("read through super", () => super.${member.name});\nnote(attributes(Below${id}${member.name}));\n}\n}`,
            `attempt("the getter that is described", () => Reflect.getOwnPropertyDescriptor(${from}, "${member.name}")?.get?.call(${from}));`,
          ]),
        );
      }
    }
    later.push(`${from}.look("at last");`);
    if (!isStatic && random.chance(0.5)) later.push(`new ${outer}().look("another instance");`);
  }
  const opening = isExpression ? `const ${outer} = class ${inner} {` : `class ${inner} {`;
  return { rows: [`${opening}\n${body.join("\n")}\n}${isExpression ? ";" : ""}`, ...later], isExpression };
}

export function generate(random: Random, option: Option): { text: string; files: Record<string, string> } {
  const rows: string[] = [];
  for (let id = 0, scenes = random.between(1, 3); id < scenes; id++) {
    const scene = classes(random, option, id).rows;
    const place = random.weighted([
      [4, "top"],
      [1, "block"],
      [2, "function"],
      [1, "loop"],
    ] as const);
    if (place === "top") rows.push(...scene);
    else if (place === "block") rows.push(`{\n${scene.join("\n")}\n}`);
    else if (place === "loop")
      rows.push(`for (let turn = 0; turn < 2; turn++) {\nnote("turn", turn);\n${scene.join("\n")}\n}`);
    else
      rows.push(
        `function scene${id}(outer: number) {\nnote("scene ${id}", outer);\n${scene.join("\n")}\n}\nscene${id}(1);\nscene${id}(2);`,
      );
  }
  return {
    text: `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\nexport {};\n`,
    files: { "tsconfig.json": tsconfig(option) },
  };
}
