// Small TypeScript programs that the checker accepts under `strict`, with no cast, no `any` written out and no `!`, and in which a value still ends up where its type says it
// cannot be, or an object stops being what its type says. A compiled program prints what plain Bun prints, whatever the types promised.
//
// A program is one HOLE of the type system, tried in a few cases. A case has its own declarations and is put together at random from
//   the type under attack   a number, a string, a function, an array, a tuple, an enum, a union, or an object type in one of a dozen forms (`forms`) with fields of every kind
//   the hole                a delivery (a value of any kind reaches a position of the type: `deliveries`), an impostor (an expression of the type that no constructor of the type made:
//                           `impostors`), or a mutation (an honest object is changed behind its type: `mutations`)
//   the value that arrives  `valuesOf`
//   where the reference is held while it is used (`places`), in what kind of function (`contexts`), how errors are caught (`styles`), and when the victim comes (`times`)
//   the uses                every field is read, then arithmetic, string methods, calls, stores, keys, JSON, spread, loops, instanceof, a typed helper that has honest callers too
// Every use prints one line, `c<case>.<stage>.<number>:<use> <typeof and value, or the class of the error>`.
//
// `filed` lists the parts that run into a bug that is filed already. They are not drawn. Take a line out when its fix is in.
//
//   bun unsound-types.ts <folder> [--count=<programs>] [--seed=<first seed>] [--holes=a,b] [--with-filed] [--cases=<cases in a program>]    writes <folder>/<seed>-<hole>.ts and a tsconfig.json
//   bun unsound-types.ts --list                                                                                                            the holes, one on a line
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Random } from "../fuzz/random";

export const tsconfig = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true, types: [] } });

/** A hole, a form or a use, and the bug it runs into. */
export const filed: Record<string, string> = {
  "kinds-of-values-of-a-spread": "every element of Object.values(<an object made by a spread or by the rest of a pattern>) is undefined to a callback and to for-of: programs/structural-types/typeof-of-each-value-of-a-spread-copy.ts",
  "values-of-a-spread-walked": "the same: programs/structural-types/the-values-of-a-spread-copy-are-walked-and-turned-into-strings.ts",
  "kinds-of-values-of-the-rest": "the same: programs/structural-types/the-values-of-the-rest-of-a-pattern-are-turned-into-strings.ts",
  "typeof-is-object": "`typeof value === \"object\"` in a closure over a captured parameter answers by the declared type, or traps: programs/structural-types/a-closure-asks-whether-its-number-parameter-is-an-object.ts",
};

type Kind = "number" | "string" | "boolean" | "inner" | "function" | "numbers" | "texts" | "enum" | "tuple" | "union" | "shape" | "maybe-inner" | "maybe-number" | "number-or-text";

interface Type {
  kind: Kind;
  text: string;
  /** Expressions that each make another honest value. They stand where the type is expected. */
  honest: string[];
  /** A test by which TypeScript narrows `unknown` to the type, true of every honest value. */
  check?: (expression: string) => string;
  shape?: Shape;
  /** For a union: values of the members that no initializer stores. */
  others?: string[];
}

interface Field {
  name: string;
  type: Type;
  initial: string;
  isOptional?: boolean;
  /** Declared and never stored. */
  isNeverMade?: "merged-interface" | "declared-field";
  /** Its type is a type parameter inside the class. */
  isGeneric?: boolean;
  isAccessor?: boolean;
  /** Its setter takes a string too. */
  hasWiderSetter?: boolean;
}

interface Shape {
  name: string;
  typeText: string;
  form: string;
  fields: Field[];
  /** The name is also a value with a prototype. */
  isClass: boolean;
  /** Private names: nothing but an instance satisfies the type. */
  isNominal: boolean;
  hasMethods: boolean;
  make: string;
  base?: { name: string; make: string };
  /** What a hole adds to the class. */
  members: string[];
  heritage?: string;
  render(): string;
}

interface Value {
  name: string;
  text: string;
  /** Its type, where that is short enough to stand in a union. */
  type?: string;
  /** The kinds it honestly belongs to. */
  kinds: Kind[];
  isJson?: boolean;
}

interface Use {
  name: string;
  setup?: (r: string) => string;
  look: (r: string) => string;
  stores?: boolean;
  /** It throws on an honest value too. */
  throws?: boolean;
}

interface Reference {
  text: string;
  canStore: boolean;
}

class Case {
  /** Declarations ahead of the type under attack, and behind it. */
  early: string[] = [];
  top: string[] = [];
  /** Declarations behind the function that uses the victim: what runs a constructor of the type. */
  late: string[] = [];
  parts: string[] = [];
  /** A kind of field that the object type has to have. */
  wantedField?: string;
  /** A constructor of the type runs the function that uses the victim, so nothing that function needs may be initialized with an instance. */
  isUsedWhileConstructed = false;
  #declared = new Set<string>();

  constructor(
    readonly id: number,
    readonly random: Random,
    readonly isAllowed: (part: string) => boolean,
  ) {}

  name(base: string) {
    return base + this.id;
  }

  declare(list: string[], key: string, text: string) {
    if (this.#declared.has(key)) return;
    this.#declared.add(key);
    list.push(text);
  }

  inner(): Type {
    const name = this.name("Inner");
    this.declare(this.early, "inner", `class ${name} {\n  depth = 1;\n  twice(): number {\n    return this.depth * 2;\n  }\n}`);
    return { kind: "inner", text: name, honest: [`new ${name}()`], check: e => `${e} instanceof ${name}` };
  }

  step(): Type {
    const name = this.name("Step");
    this.declare(this.early, "step", `type ${name} = (step: number) => number;`);
    return { kind: "function", text: name, honest: ["(step: number): number => step + 1", "(step: number): number => step * 2"] };
  }

  mode(): Type {
    const name = this.name("Mode");
    this.declare(this.early, "mode", `enum ${name} {\n  Off,\n  On,\n  Auto,\n}`);
    return { kind: "enum", text: name, honest: [`${name}.On`, `${name}.Off`, `${name}.Auto`] };
  }

  pair(): Type {
    const name = this.name("Pair");
    this.declare(this.early, "pair", `type ${name} = [number, string];`);
    return { kind: "tuple", text: name, honest: ['[1, "ab"]', '[2, "cd"]'] };
  }

  figure(): Type {
    const name = this.name("Figure");
    this.declare(this.early, "figure", `type ${name} = { kind: "circle"; radius: number } | { kind: "square"; side: number };`);
    return { kind: "union", text: name, honest: ['{ kind: "circle", radius: 2 }', '{ kind: "square", side: 3 }'] };
  }

  conversions(): string {
    this.declare(this.early, "conversions", `const ${this.name("conversions")}: string[] = [];`);
    return this.name("conversions");
  }

  stranger(): string {
    const name = this.name("Stranger");
    this.declare(this.early, "stranger", `class ${name} {\n  other = "stranger";\n  total(): string {\n    return "total of a stranger";\n  }\n}`);
    return name;
  }
}

const numberType = (isInteger: boolean): Type => ({ kind: "number", text: "number", honest: isInteger ? ["1", "2", "7", "40"] : ["1.5", "2.25", "0.5", "40.75"], check: e => `typeof ${e} === "number"` });
const stringType: Type = { kind: "string", text: "string", honest: ['"ab"', '"cd"', '"wxyz"'], check: e => `typeof ${e} === "string"` };
const booleanType: Type = { kind: "boolean", text: "boolean", honest: ["true", "false"], check: e => `typeof ${e} === "boolean"` };
const numbersType: Type = { kind: "numbers", text: "number[]", honest: ["[1, 2, 3]", "[4, 5]", "[0.5, 6, 7, 8]"], check: e => `Array.isArray(${e})` };
const textsType: Type = { kind: "texts", text: "string[]", honest: ['["ab", "cd"]', '["x", "y", "z"]'], check: e => `Array.isArray(${e})` };

const valuesOf = (c: Case): Value[] => [
  { name: "undefined", text: "undefined", type: "undefined", kinds: ["maybe-number"] },
  { name: "null", text: "null", type: "null", kinds: ["maybe-inner"], isJson: true },
  { name: "integer", text: "7", type: "number", kinds: ["number", "enum", "maybe-number", "number-or-text"], isJson: true },
  { name: "fraction", text: "2.5", type: "number", kinds: ["number", "enum", "maybe-number", "number-or-text"], isJson: true },
  { name: "negative-zero", text: "-0", type: "number", kinds: ["number", "enum", "maybe-number", "number-or-text"] },
  { name: "not-a-number", text: "NaN", type: "number", kinds: ["number", "enum", "maybe-number", "number-or-text"] },
  { name: "text", text: '"text"', type: "string", kinds: ["string", "number-or-text"], isJson: true },
  { name: "digits", text: '"3"', type: "string", kinds: ["string", "number-or-text"], isJson: true },
  { name: "empty-text", text: '""', type: "string", kinds: ["string", "number-or-text"], isJson: true },
  { name: "true", text: "true", type: "boolean", kinds: ["boolean"], isJson: true },
  { name: "bigint", text: "10n", type: "bigint", kinds: [] },
  { name: "symbol", text: 'Symbol.for("mark")', type: "symbol", kinds: [] },
  { name: "empty-array", text: "[]", kinds: ["numbers", "texts"], isJson: true },
  { name: "mixed-array", text: '[1, "two"]', kinds: ["tuple"], isJson: true },
  { name: "text-array", text: '["a", "b"]', type: "string[]", kinds: ["texts"], isJson: true },
  { name: "number-array", text: "[4, 5, 6]", type: "number[]", kinds: ["numbers"], isJson: true },
  { name: "array-of-holes", text: "new Array(2)", kinds: [] },
  { name: "proxy-of-an-array", text: 'new Proxy(["proxied", 1], {})', kinds: [] },
  { name: "empty-object", text: "({})", type: "object", kinds: [], isJson: true },
  { name: "stranger", text: `new ${c.stranger()}()`, type: c.stranger(), kinds: [] },
  { name: "arrow", text: '(): string => "called"', type: "(() => string)", kinds: [] },
  { name: "date", text: "new Date(0)", type: "Date", kinds: [] },
  { name: "map", text: "new Map<string, number>()", type: "Map<string, number>", kinds: [] },
  { name: "number-object", text: "Object(3)", kinds: [] },
  { name: "text-object", text: 'Object("ab")', kinds: [] },
  { name: "bare-object", text: "Object.create(null)", kinds: [] },
  { name: "object-with-value-of", text: `({ valueOf(): number { ${c.conversions()}.push("valueOf"); return 42; } })`, kinds: [] },
  { name: "object-with-to-string", text: `({ toString(): string { ${c.conversions()}.push("toString"); return "converted"; } })`, kinds: [] },
  { name: "object-with-to-primitive", text: `({ [Symbol.toPrimitive](hint: string): string | number { ${c.conversions()}.push(hint); return hint === "number" ? 7 : "primitive"; } })`, kinds: [] },
];

/** Values that are close to an object type and are not of it. */
function nearValues(c: Case, type: Type): Value[] {
  const shape = type.shape;
  if (!shape) return [];
  const near: Value[] = [{ name: "members-of-other-kinds", text: `({ ${shape.fields.map(field => `${field.name}: ${field.type.kind === "string" ? "7" : '"other"'}`).join(", ")} })`, kinds: [], isJson: true }];
  if (shape.base) near.push({ name: "instance-of-the-base", text: shape.base.make, type: shape.base.name, kinds: [] });
  if (shape.base && shape.form === "subclass") {
    c.declare(c.top, "sibling", `class ${c.name("Sibling")} extends ${shape.base.name} {\n  apart = "sibling";\n}`);
    near.push({ name: "instance-of-a-sibling", text: `new ${c.name("Sibling")}()`, type: c.name("Sibling"), kinds: [] });
  }
  return near;
}

function wrongValue(c: Case, type: Type, accepts: (value: Value) => boolean = () => true): Value {
  const near = nearValues(c, type).filter(accepts);
  return near.length && c.random.chance(0.4) ? c.random.pick(near) : c.random.pick(valuesOf(c).filter(value => !value.kinds.includes(type.kind) && accepts(value)));
}

/** How the value gets into the constant of type unknown: in plain sight, or through something that the compiler does not look through. */
const arrivals: { name: string; fits?: (value: Value) => boolean; from: (text: string) => string }[] = [
  { name: "in-sight", from: text => text },
  { name: "in-sight", from: text => text },
  { name: "out-of-a-list", from: text => `[0, ${text}].at(-1)` },
  { name: "out-of-json", fits: value => !!value.isJson, from: text => `JSON.parse(JSON.stringify(${text}))` },
  { name: "out-of-a-native-callback", from: text => `[0].map(() => (${text}))[0]` },
  { name: "out-of-a-promise", from: text => `await Promise.resolve(${text})` },
  { name: "out-of-a-map", from: text => `new Map<string, unknown>([["key", ${text}]]).get("key")` },
  { name: "out-of-a-computed-member", from: text => `Reflect.get({ first: 0, second: ${text} }, ["first", "second"][table.length - 2])` },
];

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The object types.

const fieldNames: Record<string, string[]> = {
  number: ["x", "y", "count", "width", "score", "level"],
  string: ["label", "title", "code", "unit"],
  boolean: ["active", "open"],
  inner: ["inner", "owner"],
  function: ["run", "advance"],
  numbers: ["items", "marks"],
  texts: ["words"],
  enum: ["mode"],
  tuple: ["pair"],
  "maybe-inner": ["leaf", "next"],
  "maybe-number": ["limit", "offset"],
  "number-or-text": ["id", "key"],
};

function drawField(c: Case, kind: string, taken: Set<string>): Field | undefined {
  const isOptional = kind.startsWith("optional-");
  const plain = isOptional ? kind.slice("optional-".length) : kind;
  const name = (isOptional ? ["note", "extra", "hint"] : fieldNames[plain]).find(each => !taken.has(each));
  if (!name) return;
  taken.add(name);
  const unions: Record<string, () => Type> = {
    "maybe-inner": () => ({ kind: "maybe-inner", text: `${c.inner().text} | null`, honest: c.inner().honest, others: ["null"] }),
    "maybe-number": () => ({ kind: "maybe-number", text: "number | undefined", honest: ["3", "4.5"], others: ["undefined"] }),
    "number-or-text": () => ({ kind: "number-or-text", text: "number | string", honest: ["11", "12"], others: ['"thirteen"', '""'] }),
  };
  const type =
    unions[plain]?.() ?? (plain === "number" ? numberType(c.random.chance(0.5)) : plain === "string" ? stringType : plain === "boolean" ? booleanType : plain === "inner" ? c.inner() : plain === "function" ? c.step() : plain === "numbers" ? numbersType : plain === "texts" ? textsType : plain === "enum" ? c.mode() : c.pair()); // prettier-ignore
  return { name, type, initial: c.random.pick(type.honest), isOptional };
}

function drawFields(c: Case): Field[] {
  const taken = new Set<string>();
  const kinds = ["number", "string", ...(c.wantedField ? [c.wantedField] : []), ...c.random.sample(["number", "number", "string", "boolean", "inner", "function", "numbers", "texts", "enum", "tuple", "optional-number", "optional-string", "maybe-inner", "maybe-number", "number-or-text"], c.random.between(0, 4))];
  return c.random.shuffled(kinds.flatMap(kind => drawField(c, kind, taken) ?? []));
}

const isStored = (field: Field) => !field.isOptional && !field.isNeverMade;
const sumOf = (fields: Field[], object: string) => fields.filter(field => field.type.kind === "number" && !field.isOptional && !field.isGeneric).map(field => `${object}.${field.name}`).join(" + ") || "0"; // prettier-ignore
const textOf = (fields: Field[], object: string) => [...fields.filter(field => field.type.kind === "string" && !field.isOptional).map(field => `${object}.${field.name}`), '":"', `(${sumOf(fields, object)})`].join(" + ");
const methodsOf = (fields: Field[], more = "") => [`total(): number {\n    return ${sumOf(fields, "this")};\n  }`, `text(): string {\n    return ${textOf(fields, "this")}${more};\n  }`];
const needsItsType = (field: Field) => ["function", "enum", "tuple", "maybe-inner", "maybe-number", "number-or-text"].includes(field.type.kind);
const declared = (field: Field) => `${field.name}${field.isOptional ? "?" : ""}: ${field.type.text};`;
const initialized = (field: Field, isExplicit: boolean) => (field.isOptional ? declared(field) : isExplicit || needsItsType(field) ? `${field.name}: ${field.type.text} = ${field.initial};` : `${field.name} = ${field.initial};`);
const block = (head: string, lines: string[]) => `${head} {\n${lines.map(line => `  ${line}\n`).join("")}}`;
const literalOf = (fields: Field[], members: string[] = []) => `{ ${[...fields.filter(isStored).map(field => `${field.name}: ${field.initial}`), ...members].join(", ")} }`;
const inOneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

const classForms = ["class-fields", "class-fields-with-types", "class-constructor", "parameter-properties", "subclass", "generic-class", "private-beside", "accessor-pair", "wider-setter"];
const literalForms = ["interface-literal", "type-literal", "interface-without-methods", "static-side"];
const dynamicForms = ["extends-parameter", "three-mixins", "factory-class", "extends-an-expression"];
export const forms = [...classForms, ...literalForms, ...dynamicForms];

function drawShape(c: Case, wanted: string[] = forms): Shape {
  const allowed = wanted.filter(c.isAllowed);
  const form = c.random.pick(allowed.length ? allowed : ["class-fields"]);
  const name = c.name(c.random.pick(["Point", "Account", "Parcel", "Track", "Sensor", "Ticket", "Planet", "Recipe"]));
  const fields = drawFields(c);
  const shape: Shape = { name, typeText: name, form, fields, isClass: true, isNominal: false, hasMethods: true, make: `new ${name}()`, members: [], render: () => "" };
  // Members that only native code calls.
  if (classForms.includes(form) && c.random.chance(0.3) && (shape.isNominal = true))
    shape.members.push(
      ...c.random.sample(
        [
          `toJSON(): unknown {\n    return { total: this.total() };\n  }`,
          `toString(): string {\n    return "text of " + this.text();\n  }`,
          `valueOf(): number {\n    return this.total();\n  }`,
          `[Symbol.toPrimitive](hint: string): string | number {\n    return hint === "number" ? this.total() : hint + " of " + this.text();\n  }`,
          `get [Symbol.toStringTag](): string {\n    return "Tagged";\n  }`,
        ],
        c.random.between(1, 2),
      ),
    );
  const head = () => `class ${name}${shape.heritage ? ` ${shape.heritage}` : ""}`;
  const merged = () => fields.filter(field => field.isNeverMade === "merged-interface").map(field => `interface ${name} {\n  ${declared(field)}\n}\n`).join(""); // prettier-ignore
  const onlyDeclared = () => fields.filter(field => field.isNeverMade === "declared-field").map(field => `declare ${declared(field)}`);
  const made = () => fields.filter(field => !field.isNeverMade);

  if (form === "class-fields" || form === "class-fields-with-types") {
    shape.render = () => merged() + block(head(), [...made().map(field => initialized(field, form !== "class-fields")), ...onlyDeclared(), ...methodsOf(fields), ...shape.members]);
  } else if (form === "class-constructor") {
    const given = fields.filter(field => isStored(field) && (field.type.kind === "number" || field.type.kind === "string"));
    shape.make = `new ${name}(${given.map(field => field.initial).join(", ")})`;
    shape.render = () =>
      merged() +
      block(head(), [
        ...made().map(declared),
        ...onlyDeclared(),
        `constructor(${given.map(field => `${field.name}: ${field.type.text}`).join(", ")}) {\n${made().filter(isStored).map(field => `    this.${field.name} = ${given.includes(field) ? field.name : field.initial};\n`).join("")}  }`, // prettier-ignore
        ...methodsOf(fields),
        ...shape.members,
      ]);
  } else if (form === "parameter-properties") {
    shape.render = () => merged() + block(head(), [...onlyDeclared(), `constructor(\n${made().map(field => `    public ${field.isOptional ? declared(field).slice(0, -1) : `${field.name}: ${field.type.text} = ${field.initial}`},\n`).join("")}  ) {}`, ...methodsOf(fields), ...shape.members]); // prettier-ignore
  } else if (form === "subclass") {
    const root = c.name("Root");
    const cut = c.random.between(1, fields.length - 1);
    shape.base = { name: root, make: `new ${root}()` };
    shape.render = () => {
      const [above, below] = [made().slice(0, cut), made().slice(cut)];
      return `${block(`class ${root}`, above.map(field => initialized(field, false)))}\n${merged()}${block(`class ${name} extends ${root}`, [...below.map(field => initialized(field, false)), ...onlyDeclared(), ...methodsOf(fields), ...shape.members])}`; // prettier-ignore
    };
  } else if (form === "generic-class") {
    fields.unshift({ name: "held", type: numberType(true), initial: "7", isGeneric: true });
    shape.typeText = `${name}<number>`;
    shape.make = `new ${name}(7)`;
    shape.render = () => block(`class ${name}<V>`, ["held: V;", ...made().filter(field => !field.isGeneric).map(field => initialized(field, false)), "constructor(held: V) {\n    this.held = held;\n  }", ...methodsOf(fields), ...shape.members]); // prettier-ignore
  } else if (form === "private-beside") {
    shape.isNominal = true;
    shape.render = () => merged() + block(head(), ["#secret = 7;", ...made().map(field => initialized(field, false)), ...onlyDeclared(), ...methodsOf(fields, " + this.#secret"), ...shape.members]);
  } else if (form === "accessor-pair" || form === "wider-setter") {
    const behind = fields.find(field => field.type.kind === "number" && isStored(field))!;
    behind.isAccessor = true;
    behind.hasWiderSetter = form === "wider-setter";
    shape.isNominal = true;
    const pair = [`#${behind.name} = ${behind.initial};`, `get ${behind.name}(): number {\n    return this.#${behind.name};\n  }`, behind.hasWiderSetter ? `set ${behind.name}(value: number | string) {\n    this.#${behind.name} = Number(value);\n  }` : `set ${behind.name}(value: number) {\n    this.#${behind.name} = value;\n  }`]; // prettier-ignore
    shape.render = () => merged() + block(head(), [...made().flatMap(field => (field === behind ? pair : [initialized(field, false)])), ...onlyDeclared(), ...methodsOf(fields), ...shape.members]);
  } else if (form === "static-side") {
    shape.isClass = false;
    shape.isNominal = true;
    shape.typeText = `typeof ${name}`;
    shape.make = name;
    shape.render = () => block(`class ${name}`, [...fields.map(field => `static ${initialized(field, false)}`), ...methodsOf(fields).map(method => `static ${method}`)]);
  } else if (form === "extends-an-expression") {
    const root = c.name("Root");
    const cut = c.random.between(1, fields.length - 1);
    const base = c.random.pick([`${c.name("pickBase")}()`, `(table.length ? ${root} : ${root})`, `new Proxy(${root}, {})`, `Object.assign(${root}.bind(null), { prototype: ${root}.prototype })`, `${c.name("bases")}.first`, `Object.assign(${root}, {})`, `(${c.name("bases")}.first ?? ${root})`]);
    shape.base = { name: root, make: `new ${root}()` };
    shape.render = () =>
      `${block(`class ${root}`, fields.slice(0, cut).map(field => initialized(field, false)))}\nfunction ${c.name("pickBase")}() {\n  return ${root};\n}\nconst ${c.name("bases")} = { first: ${root} };\n` + // prettier-ignore
      block(`class ${name} extends ${base}`, [...fields.slice(cut).map(field => initialized(field, false)), ...methodsOf(fields), ...shape.members]);
  } else if (form === "factory-class") {
    shape.render = () => `function ${c.name("define")}() {\n  return ${block("class", [...fields.map(field => initialized(field, false)), ...methodsOf(fields), ...shape.members]).replace(/\n/g, "\n  ")};\n}\nconst ${name} = ${c.name("define")}();\ntype ${name} = InstanceType<typeof ${name}>;`;
  } else if (form === "extends-parameter" || form === "three-mixins") {
    const root = c.name("Root");
    const levels = form === "three-mixins" ? 3 : 1;
    const cuts = Array.from({ length: levels + 1 }, (_, level) => Math.min(fields.length, level === levels ? fields.length : level + 1));
    shape.base = { name: root, make: `new ${root}()` };
    shape.render = () => {
      let text = block(`class ${root}`, fields.slice(0, cuts[0]).map(field => initialized(field, false))) + "\n"; // prettier-ignore
      let [above, value] = [root, root];
      for (let level = 1; level <= levels; level++) {
        const isLast = level === levels;
        const mixin = c.name(["withFirst", "withSecond", "withThird"][level - 1]);
        text += `function ${mixin}(Base: new () => ${above}) {\n  return ${block("class extends Base", [...fields.slice(cuts[level - 1], cuts[level]).map(field => initialized(field, false)), ...(isLast ? [...methodsOf(fields), ...shape.members] : [])]).replace(/\n/g, "\n  ")};\n}\n`; // prettier-ignore
        above = `InstanceType<ReturnType<typeof ${mixin}>>`;
        value = `${mixin}(${value})`;
      }
      return `${text}const ${name} = ${value};\ntype ${name} = InstanceType<typeof ${name}>;`;
    };
  } else {
    shape.isClass = false;
    shape.hasMethods = form !== "interface-without-methods";
    shape.make = `${c.name("make")}()`;
    const signatures = shape.hasMethods ? ["total(): number;", "text(): string;"] : [];
    shape.render = () =>
      `${form === "type-literal" ? block(`type ${name} =`, [...fields.map(declared), ...signatures]) + ";" : block(`interface ${name}`, [...fields.map(declared), ...signatures])}\n` +
      `function ${c.name("make")}(): ${name} {\n  return ${literalOf(fields, shape.hasMethods ? methodsOf(fields).map(inOneLine) : [])};\n}`;
  }
  return shape;
}

const shapeType = (shape: Shape): Type => ({ kind: "shape", text: shape.typeText, honest: [shape.make], shape, check: shape.isClass ? e => `${e} instanceof ${shape.name}` : undefined });

/** A class of another name that satisfies the type: the same members in the reverse order, and methods with other answers. */
function twinOf(c: Case, shape: Shape, hasGetters: boolean): string {
  const name = c.name("Twin");
  const fields = [...shape.fields].reverse().filter(isStored);
  const lines = fields.map(field => (hasGetters && field.type.kind === "number" ? `get ${field.name}(): number {\n    return ${field.initial};\n  }\n  set ${field.name}(value: number) {}` : initialized(field, true)));
  c.declare(c.top, "twin", block(`class ${name}`, [...lines, ...(shape.hasMethods ? ["total(): number {\n    return -1;\n  }", 'text(): string {\n    return "twin";\n  }'] : [])]));
  return name;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The uses.

/** Tests whose answer the declared type seems to give away. */
const typeTests: Use[] = [
  ...["undefined", "number", "string", "boolean", "object", "function", "bigint", "symbol"].map(name => ({ name: `typeof-is-${name}`, look: (r: string) => `typeof ${r} === "${name}"` })),
  { name: "is-undefined", look: r => `${r} === undefined` },
  { name: "is-null", look: r => `${r} === null` },
  { name: "is-nullish", look: r => `${r} == null` },
  { name: "or-fallback", look: r => `${r} ?? "fallback"` },
  { name: "chained-to-string", look: r => `${r}?.toString()` },
  { name: "is-truthy", look: r => `${r} ? "yes" : "no"` },
  { name: "negation", look: r => `!${r}` },
  { name: "or-other", look: r => `${r} || "other"` },
  { name: "is-itself", look: r => `Object.is(${r}, ${r})` },
  { name: "in-a-set", look: r => `new Set([${r}]).has(${r})` },
  { name: "in-a-list", look: r => `[${r}].includes(${r})` },
  { name: "as-json", look: r => `JSON.stringify([${r}])` },
  { name: "as-text", look: r => `String(${r})` },
];

const numberUses: Use[] = [
  { name: "plus", look: r => `${r} + 1` },
  { name: "times", look: r => `${r} * 2` },
  { name: "minus", look: r => `${r} - 0.5` },
  { name: "negated", look: r => `-${r}` },
  { name: "bits", look: r => `${r} | 0` },
  { name: "shifted", look: r => `${r} >>> 1` },
  { name: "remainder", look: r => `${r} % 3` },
  { name: "greater", look: r => `${r} > 1` },
  { name: "equal", look: r => `${r} === 2` },
  { name: "fixed", look: r => `${r}.toFixed(1)` },
  { name: "floor", look: r => `Math.floor(${r})` },
  { name: "max", look: r => `Math.max(${r}, 1)` },
  { name: "as-index", look: r => `table[${r}]` },
  { name: "joined", look: r => `"n" + ${r}` },
  { name: "template", look: r => "`<${" + r + "}>`" },
  { name: "is-integer", look: r => `Number.isInteger(${r})` },
  { name: "is-nan", look: r => `Number.isNaN(${r})` },
  { name: "truthy", look: r => `${r} ? "yes" : "no"` },
  { name: "typeof", look: r => `typeof ${r}` },
  { name: "radix", look: r => `${r}.toString(2)` },
  { name: "summed", setup: r => `let sum = 0; for (let i = 0; i < 3; i++) sum += ${r};`, look: () => "sum" },
  { name: "divided", look: r => `${r} / 4` },
  { name: "power", look: r => `${r} ** 2` },
  { name: "and-bits", look: r => `${r} & 6` },
  { name: "xor-bits", look: r => `${r} ^ 5` },
  { name: "inverted", look: r => `~${r}` },
  { name: "shifted-left", look: r => `${r} << 2` },
  { name: "at-most", look: r => `${r} <= 2` },
  { name: "loosely-equal", look: r => `${r} == 2` },
  { name: "is-negative-zero", look: r => `Object.is(${r}, -0)` },
  { name: "not-itself", look: r => `${r} !== ${r}` },
  { name: "truncated", look: r => `Math.trunc(${r})` },
  { name: "rounded", look: r => `Math.round(${r})` },
  { name: "sign", look: r => `Math.sign(${r})` },
  { name: "absolute", look: r => `Math.abs(${r})` },
  { name: "root", look: r => `Math.sqrt(${r})` },
  { name: "min", look: r => `Math.min(${r}, 3)` },
  { name: "multiplied-as-int32", look: r => `Math.imul(${r}, 3)` },
  { name: "leading-zeros", look: r => `Math.clz32(${r})` },
  { name: "as-float32", look: r => `Math.fround(${r})` },
  { name: "is-finite", look: r => `Number.isFinite(${r})` },
  { name: "is-safe", look: r => `Number.isSafeInteger(${r})` },
  { name: "precision", look: r => `${r}.toPrecision(3)` },
  { name: "repeats", look: r => `"ab".repeat(${r})` },
  { name: "slices-text", look: r => `"abcdef".slice(${r})` },
  { name: "character-at", look: r => `"abcdef".charAt(${r})` },
  { name: "slices-list", look: r => `table.slice(${r})` },
  { name: "list-at", look: r => `table.at(${r})` },
  { name: "is-index", look: r => `${r} in table` },
  { name: "as-length", look: r => `new Array<number>(${r}).length` },
  { name: "as-time", look: r => `new Date(${r}).getTime()` },
  { name: "as-bigint", look: r => `BigInt(${r})` },
  { name: "counts-a-loop", setup: r => `let turns = 0; for (let i = 0; i < ${r} && i < 50; i++) turns++;`, look: () => "turns" },
  { name: "switched", setup: r => `let word = "other"; switch (${r}) { case 1: word = "one"; break; case 2: word = "two"; break; case 7: word = "seven"; break; }`, look: () => "word" },
  { name: "in-a-typed-array", setup: r => `const cells = new Float64Array(2); cells[0] = ${r};`, look: () => "cells[0]" },
  { name: "in-an-int32-array", setup: r => `const cells = new Int32Array(2); cells[0] = ${r};`, look: () => "cells[0]" },
  { name: "pushed-to-numbers", setup: r => `const gathered: number[] = [1, 2]; gathered.push(${r});`, look: () => "gathered" },
  { name: "incremented", setup: r => `${r}++;`, look: r => r, stores: true },
  { name: "added-to", setup: r => `${r} += 2;`, look: r => r, stores: true },
  { name: "stored", setup: r => `${r} = 5;`, look: r => r, stores: true },
];

const stringUses: Use[] = [
  { name: "length", look: r => `${r}.length` },
  { name: "upper", look: r => `${r}.toUpperCase()` },
  { name: "joined", look: r => `${r} + "!"` },
  { name: "code", look: r => `${r}.charCodeAt(0)` },
  { name: "slice", look: r => `${r}.slice(1)` },
  { name: "equal", look: r => `${r} === "ab"` },
  { name: "first", look: r => `${r}[0]` },
  { name: "padded", look: r => `${r}.padStart(4, "-")` },
  { name: "includes", look: r => `${r}.includes("a")` },
  { name: "less", look: r => `${r} < "b"` },
  { name: "spread", look: r => `[...${r}].length` },
  { name: "template", look: r => "`<${" + r + "}>`" },
  { name: "typeof", look: r => `typeof ${r}` },
  { name: "split", look: r => `${r}.split("").length` },
  { name: "to-number", look: r => `Number(${r})` },
  { name: "last", look: r => `${r}.at(-1)` },
  { name: "repeated", look: r => `${r}.repeat(2)` },
  { name: "as-key", look: r => `lookup[${r}]` },
  { name: "letters", setup: r => `let seen = ""; for (const letter of ${r}) seen += letter + ".";`, look: () => "seen" },
  { name: "compared", look: r => `${r}.localeCompare("b")` },
  { name: "starts-with", look: r => `${r}.startsWith("a")` },
  { name: "index-of", look: r => `${r}.indexOf("b")` },
  { name: "replaced", look: r => `${r}.replace("a", "-")` },
  { name: "matched", look: r => `${r}.match(/[a-c]+/)?.[0]` },
  { name: "tested", look: r => `/^[a-z]+$/.test(${r})` },
  { name: "trimmed", look: r => `${r}.trim()` },
  { name: "lower", look: r => `${r}.toLowerCase()` },
  { name: "concat", look: r => `${r}.concat("?", ${r})` },
  { name: "code-point", look: r => `${r}.codePointAt(0)` },
  { name: "substring", look: r => `${r}.substring(0, 1)` },
  { name: "parsed", look: r => `parseInt(${r}, 10)` },
  { name: "unary-plus", look: r => `+${r}` },
  { name: "loosely-equal", look: r => `${r} == "ab"` },
  { name: "or-empty", look: r => `${r} || "empty"` },
  { name: "computed-key", look: r => `({ [${r}]: 1 })` },
  { name: "is-key", look: r => `${r} in lookup` },
  { name: "from", look: r => `Array.from(${r})` },
  { name: "longer-than-one", look: r => `${r}.length > 1` },
  { name: "encoded", look: r => `encodeURIComponent(${r})` },
  { name: "registered", look: r => `Symbol.for(${r}).description` },
  { name: "switched", setup: r => `let word = 0; switch (${r}) { case "ab": word = 1; break; case "cd": word = 2; break; case "text": word = 3; break; }`, look: () => "word" },
  { name: "built-up", setup: r => `let built = ""; for (let i = 0; i < 3; i++) built += ${r};`, look: () => "built" },
  { name: "pushed-to-texts", setup: r => `const gathered: string[] = ["a"]; gathered.push(${r});`, look: () => 'gathered.join("|")' },
  { name: "stored", setup: r => `${r} = "new";`, look: r => r, stores: true },
  { name: "appended", setup: r => `${r} += "+";`, look: r => r, stores: true },
];

const booleanUses: Use[] = [
  { name: "not", look: r => `!${r}` },
  { name: "chooses", look: r => `${r} ? 1 : 2` },
  { name: "and", look: r => `${r} && "on"` },
  { name: "equal", look: r => `${r} === true` },
  { name: "to-number", look: r => `Number(${r})` },
  { name: "typeof", look: r => `typeof ${r}` },
  { name: "stored", setup: r => `${r} = !${r};`, look: r => r, stores: true },
];

const innerUses = (name: string): Use[] => [
  { name: "depth", look: r => `${r}.depth` },
  { name: "depth-plus", look: r => `${r}.depth + 1` },
  { name: "twice", look: r => `${r}.twice()` },
  { name: "instanceof", look: r => `${r} instanceof ${name}` },
  { name: "keys", look: r => `Object.keys(${r}).join()` },
  { name: "json", look: r => `JSON.stringify(${r})` },
  { name: "depth-stored", setup: r => `${r}.depth = 4;`, look: r => `${r}.twice()` },
  { name: "replaced", setup: r => `${r} = new ${name}();`, look: r => `${r}.depth`, stores: true },
];

const functionUses: Use[] = [
  { name: "called", look: r => `${r}(2)` },
  { name: "called-plus", look: r => `${r}(2) + 1` },
  { name: "typeof", look: r => `typeof ${r}` },
  { name: "arity", look: r => `${r}.length` },
  { name: "by-call", look: r => `${r}.call(undefined, 3)` },
  { name: "by-apply", look: r => `${r}.apply(undefined, [4])` },
  { name: "bound", look: r => `${r}.bind(undefined, 5)()` },
  { name: "mapped", look: r => `[1, 2].map(${r}).join()` },
  { name: "stored", setup: r => `${r} = (step: number): number => step * 3;`, look: r => `${r}(2)`, stores: true },
];

const arrayUses = (isNumbers: boolean): Use[] => [
  { name: "length", look: r => `${r}.length` },
  { name: "first", look: r => `${r}[0]` },
  { name: "first-used", look: r => (isNumbers ? `${r}[0] + 1` : `${r}[0].length`) },
  { name: "second-used", look: r => (isNumbers ? `${r}[1] * 2` : `${r}[1].toUpperCase()`) },
  { name: "mapped", look: r => (isNumbers ? `${r}.map(each => each * 2)` : `${r}.map(each => each + "!")`) },
  { name: "walked", setup: r => (isNumbers ? `let sum = 0; for (const each of ${r}) sum += each;` : `let sum = ""; for (const each of ${r}) sum += each;`), look: () => "sum" },
  { name: "indexed", setup: r => (isNumbers ? `let sum = 0; for (let i = 0; i < ${r}.length; i++) sum += ${r}[i];` : `let sum = ""; for (let i = 0; i < ${r}.length; i++) sum += ${r}[i];`), look: () => "sum" },
  { name: "joined", look: r => `${r}.join("-")` },
  { name: "spread", look: r => `[...${r}]` },
  { name: "index-of", look: r => `${r}.indexOf(${isNumbers ? "2" : '"cd"'})` },
  { name: "reduced", look: r => (isNumbers ? `${r}.reduce((sum, each) => sum + each, 0)` : `${r}.reduce((sum, each) => sum + each, "")`) },
  { name: "slice", look: r => `${r}.slice(1)` },
  { name: "last", look: r => `${r}.at(-1)` },
  { name: "includes", look: r => `${r}.includes(${isNumbers ? "2" : '"cd"'})` },
  { name: "is-array", look: r => `Array.isArray(${r})` },
  { name: "filtered", look: r => (isNumbers ? `${r}.filter(each => each > 1)` : `${r}.filter(each => each.length > 1)`) },
  { name: "concat", look: r => `${r}.concat(${isNumbers ? "[9]" : '["z"]'})` },
  { name: "has-second", look: r => `1 in ${r}` },
  { name: "keys", look: r => `Object.keys(${r}).join()` },
  { name: "json", look: r => `JSON.stringify(${r})` },
  { name: "sorted-copy", look: r => `${r}.toSorted()` },
  { name: "destructured", setup: r => `const [first, second] = ${r};`, look: () => "[first, second]" },
  { name: "kinds-of-a-spread", look: r => `[...${r}].map(each => typeof each).join()` },
  { name: "kinds-of-a-slice", look: r => `${r}.slice().map(each => typeof each).join()` },
  { name: "kinds-by-from", look: r => `Array.from(${r}, each => typeof each).join()` },
  { name: "kinds-of-values", look: r => `Object.values(${r}).map(each => typeof each).join()` },
  { name: "includes-a-missing-one", look: r => `${r}.includes(${r}[9])` },
  { name: "index-of-a-missing-one", look: r => `${r}.indexOf(${r}[9])` },
  { name: "last-index-of", look: r => `${r}.lastIndexOf(${r}[0])` },
  { name: "find-undefined", look: r => `${r}.findIndex(each => each === undefined)` },
  { name: "find-last", look: r => `${r}.findLast(() => true)` },
  { name: "some-undefined", look: r => `${r}.some(each => each === undefined)` },
  { name: "every-typeof", look: r => `${r}.every(each => typeof each === "${isNumbers ? "number" : "string"}")` },
  { name: "typeof-elements", look: r => `${r}.map(each => typeof each).join()` },
  { name: "first-is-undefined", look: r => `${r}[0] === undefined` },
  { name: "second-typeof", look: r => `typeof ${r}[1]` },
  { name: "reduced-from-the-right", look: r => (isNumbers ? `${r}.reduceRight((sum, each) => sum - each, 0)` : `${r}.reduceRight((sum, each) => sum + each, "")`) },
  { name: "flat-mapped", look: r => `${r}.flatMap(each => [each, each])` },
  { name: "flattened", look: r => `${r}.flat()` },
  { name: "reversed-copy", look: r => `${r}.toReversed()` },
  { name: "with-one-replaced", look: r => `${r}.with(0, ${isNumbers ? "5" : '"w"'})` },
  { name: "spliced-copy", look: r => `${r}.toSpliced(0, 1)` },
  { name: "from", look: r => `Array.from(${r})` },
  { name: "index-keys", look: r => `[...${r}.keys()].join()` },
  { name: "entries", look: r => `[...${r}.entries()].length` },
  { name: "object-entries", look: r => `Object.entries(${r}).length` },
  { name: "for-in", setup: r => `let names = ""; for (const name in ${r}) names += name + ",";`, look: () => "names" },
  { name: "to-string", look: r => `String(${r})` },
  { name: "set-size", look: r => `new Set(${r}).size` },
  { name: "cloned", look: r => `structuredClone(${r})` },
  ...(isNumbers ? [{ name: "max-of-all", look: (r: string) => `Math.max(...${r})` }, { name: "to-typed-array", look: (r: string) => `Array.from(new Float64Array(${r}))` }, { name: "sum-of-doubles", setup: (r: string) => `let sum = 0.5; for (let i = 0; i < ${r}.length; i++) sum += ${r}[i] * 0.5;`, look: () => "sum" }] : []),
  { name: "reversed", setup: r => `${r}.reverse();`, look: r => r },
  { name: "sorted", setup: r => `${r}.sort();`, look: r => r },
  { name: "shifted", look: r => `${r}.shift()` },
  { name: "unshifted", setup: r => `if (${r}.length < 40) ${r}.unshift(${isNumbers ? "0" : '"u"'});`, look: r => r },
  { name: "spliced", look: r => `${r}.splice(0, 1)` },
  { name: "filled", setup: r => `${r}.fill(${isNumbers ? "3" : '"f"'}, 1);`, look: r => r },
  { name: "copied-within", setup: r => `${r}.copyWithin(0, 1);`, look: r => r },
  { name: "stored-past-the-end", setup: r => `if (${r}.length < 40) ${r}[${r}.length + 1] = ${isNumbers ? "6" : '"p"'};`, look: r => r },
  { name: "each", setup: r => `let seen = ""; ${r}.forEach((each, index) => { seen += index + ":" + typeof each + " "; });`, look: () => "seen" },
  { name: "pushed", setup: r => `if (${r}.length < 40) ${r}.push(${isNumbers ? "4" : '"e"'});`, look: r => `${r}.length` },
  { name: "element-stored", setup: r => `${r}[0] = ${isNumbers ? "7" : '"s"'};`, look: r => `${r}[0]` },
  { name: "popped", look: r => `${r}.pop()` },
  { name: "shortened", setup: r => `${r}.length = 1;`, look: r => r },
];

const enumUses = (name: string): Use[] => [
  { name: "reverse", look: r => `${name}[${r}]` },
  { name: "switched", setup: r => `let word = ""; const it = ${r}; switch (it) { case ${name}.Off: word = "off"; break; case ${name}.On: word = "on"; break; case ${name}.Auto: word = "auto"; break; default: word = "none of them: " + describe(it); }`, look: () => "word" },
  { name: "what-is-left", setup: r => `let word = "a member"; const it = ${r}; if (it !== ${name}.Off && it !== ${name}.On && it !== ${name}.Auto) word = "left over: " + describe(it) + " " + (it === undefined);`, look: () => "word" },
  { name: "plus", look: r => `${r} + 1` },
  { name: "equal", look: r => `${r} === ${name}.On` },
  { name: "or", look: r => `${r} | ${name}.Auto` },
  { name: "as-index", look: r => `table[${r}]` },
  { name: "typeof", look: r => `typeof ${r}` },
  { name: "greater", look: r => `${r} > ${name}.Off` },
  { name: "stored", setup: r => `${r} = (${r} + 1) % 3;`, look: r => r, stores: true },
];

const tupleUses: Use[] = [
  { name: "first-plus", look: r => `${r}[0] + 1` },
  { name: "second-length", look: r => `${r}[1].length` },
  { name: "length", look: r => `${r}.length` },
  { name: "destructured", setup: r => `const [first, second] = ${r};`, look: () => "[first * 2, second.toUpperCase()]" },
  { name: "spread", look: r => `[...${r}]` },
  { name: "joined", look: r => `${r}.join()` },
  { name: "json", look: r => `JSON.stringify(${r})` },
  { name: "first-stored", setup: r => `${r}[0] = 9;`, look: r => `${r}[0]` },
];

const unionUses: Use[] = [
  { name: "kind", look: r => `${r}.kind` },
  { name: "narrowed", setup: r => `let area = 0; const it = ${r}; if (it.kind === "circle") area = it.radius * 2; else area = it.side + 1;`, look: () => "area" },
  { name: "switched", setup: r => `let area = 0; const it = ${r}; switch (it.kind) { case "circle": area = it.radius * 3; break; case "square": area = it.side * it.side; break; }`, look: () => "area" },
  { name: "by-in", setup: r => `let size = 0; const it = ${r}; if ("radius" in it) size = it.radius; else size = it.side;`, look: () => "size" },
  { name: "keys", look: r => `Object.keys(${r}).join()` },
  { name: "json", look: r => `JSON.stringify(${r})` },
  { name: "spread", look: r => `({ ...${r} })` },
];

/** The value is read once: TypeScript narrows a constant, and not the result of a call. */
const once = (name: string, look: string): Use => ({ name, setup: r => `const it = ${r};`, look: () => look });
const unionFieldUses: Record<string, Use[]> = {
  "maybe-inner": [
    once("null-or-depth", "it === null ? -1 : it.depth"),
    once("chained-depth", "it?.depth"),
    once("truthy-or-none", 'it ? it.twice() : "none"'),
    once("not-null-and-deep", "it !== null && it.depth > 0"),
    once("is-nullish", "it == null"),
    once("typeof", "typeof it"),
    { name: "guarded", setup: r => `let depth = -2; const it = ${r}; if (it !== null) depth = it.depth + 1;`, look: () => "depth" },
  ],
  "maybe-number": [
    once("undefined-or-plus", 'it === undefined ? "none" : it + 1'),
    once("or-minus-one", "it ?? -1"),
    once("or-zero-times", "(it ?? 0) * 2"),
    once("chained-fixed", "it?.toFixed(1)"),
    once("typeof-is-number", 'typeof it === "number"'),
    { name: "guarded", setup: r => `let sum = 0; const it = ${r}; if (it !== undefined) sum += it;`, look: () => "sum" },
  ],
  "number-or-text": [
    once("number-or-length", 'typeof it === "number" ? it + 1 : it.length'),
    once("text-or-twice", 'typeof it === "string" ? it.toUpperCase() : it * 2'),
    once("as-text", "String(it)"),
    once("joined", 'it + "!"'),
    once("typeof", "typeof it"),
    { name: "guarded", setup: r => `let sum = 0; const it = ${r}; if (typeof it === "number") sum += it; else sum -= it.length;`, look: () => "sum" },
  ],
};

const optionalUses = (field: Field): Use[] => [
  { name: "or-else", look: r => `${r} ?? "none"` },
  { name: "chained", look: r => (field.type.kind === "number" ? `${r}?.toFixed(1)` : `${r}?.length`) },
  { name: "is-undefined", look: r => `${r} === undefined` },
  { name: "typeof", look: r => `typeof ${r}` },
  { name: "stored", setup: r => `${r} = ${field.type.honest[0]};`, look: r => r },
];

function wholeUses(c: Case, shape: Shape): Use[] {
  const some = () => c.random.pick(shape.fields).name;
  const two = c.random.sample(shape.fields, 2).map(field => field.name);
  return [
    { name: "keys", look: r => `Object.keys(${r}).join()` },
    { name: "json", look: r => `JSON.stringify(${r})` },
    { name: "spread", look: r => `({ ...${r} })` },
    { name: "for-in", setup: r => `let names = ""; for (const name in ${r}) names += name + ",";`, look: () => "names" },
    { name: "entries", look: r => `Object.entries(${r}).length` },
    { name: "values", look: r => `Object.values(${r}).length` },
    { name: "own-names", look: r => `Object.getOwnPropertyNames(${r}).join()` },
    { name: "has", look: r => `"${some()}" in ${r}` },
    { name: "has-own", look: r => `Object.hasOwn(${r}, "${some()}")` },
    { name: "descriptor", look: r => `Object.getOwnPropertyDescriptor(${r}, "${some()}")` },
    { name: "destructured", setup: r => `const { ${two.join(", ")} } = ${r};`, look: () => `[${two.join(", ")}]` },
    { name: "helper", look: r => `${c.name("helper")}(${r})` },
    { name: "helper-by-call", look: r => `${c.name("helper")}.call(undefined, ${r})` },
    { name: "helper-by-apply", look: r => `${c.name("helper")}.apply(undefined, [${r}])` },
    { name: "helper-by-reflect", look: r => `Reflect.apply(${c.name("helper")}, undefined, [${r}])` },
    { name: "helper-bound", look: r => `${c.name("helper")}.bind(undefined, ${r})()` },
    { name: "helper-as-a-callback", look: r => `[${r}].map(${c.name("helper")})` },
    { name: "scaled", look: r => `${c.name("scaled")}(${r}, 2.5)` },
    { name: "scaled-by-call", look: r => `${c.name("scaled")}.call(undefined, ${r}, 2.5)` },
    { name: "scaled-by-apply", look: r => `${c.name("scaled")}.apply(undefined, [${r}, 1.5])` },
    { name: "is-frozen", look: r => `Object.isFrozen(${r})` },
    { name: "is-extensible", look: r => `Object.isExtensible(${r})` },
    { name: "typeof", look: r => `typeof ${r}` },
    { name: "to-string", look: r => `String(${r})` },
    { name: "copied", look: r => `Object.assign({}, ${r})` },
    { name: "kinds-of-values", look: r => `Object.values(${r}).map(each => typeof each).join()` },
    { name: "some-value-is-undefined", look: r => `Object.values(${r}).some(each => each === undefined)` },
    { name: "kinds-of-values-of-a-spread", look: r => `Object.values({ ...${r} }).map(each => typeof each).join()` },
    { name: "values-of-a-spread-walked", setup: r => `let found = ""; for (const each of Object.values({ ...${r} })) found += typeof each + (each === undefined ? "!" : ".");`, look: () => "found" },
    { name: "kinds-of-values-of-the-rest", setup: r => `const { ${two[0]}, ...rest } = ${r};`, look: () => `[typeof ${two[0]}, Object.values(rest).map(each => typeof each).join()]` },
    { name: "kinds-of-entries-of-a-spread", look: r => `Object.entries({ ...${r} }).map(([key, value]) => key + " " + typeof value).join()` },
    { name: "kinds-of-values-of-an-assigned-copy", look: r => `Object.values(Object.assign({}, ${r})).map(each => typeof each).join()` },
    { name: "kinds-by-reflect-get", look: r => `Object.keys(${r}).map(key => typeof Reflect.get(${r}, key)).join()` },
    { name: "own-keys", look: r => `Reflect.ownKeys(${r}).length` },
    { name: "is-sealed", look: r => `Object.isSealed(${r})` },
    { name: "json-in-a-list", look: r => `JSON.stringify([${r}], null, 1)` },
    { name: "map-of-entries", look: r => `new Map(Object.entries(${r})).size` },
    { name: "spread-with-more", look: r => `({ before: 0, ...${r}, after: 1 })` },
    { name: "has-own-property", look: r => `${r}.hasOwnProperty("${some()}")` },
    { name: "is-enumerable", look: r => `${r}.propertyIsEnumerable("${some()}")` },
    { name: "own-to-string", look: r => `${r}.toString()` },
    { name: "typeof-value-of", look: r => `typeof ${r}.valueOf()` },
    { name: "tag", look: r => `Object.prototype.toString.call(${r})` },
    { name: "kinds-of-entries", look: r => `Object.entries(${r}).map(([key, value]) => key + " " + typeof value).join()` },
    { name: "rest", setup: r => `const { ${two[0]}, ...rest } = ${r};`, look: () => `[${two[0]}, rest]` },
    { name: "weak-key", look: r => `new WeakMap([[${r}, 1]]).get(${r})` },
    { name: "is-array", look: r => `Array.isArray(${r})` },
    { name: "instance-of-object", look: r => `${r} instanceof Object` },
    { name: "joined-to-text", look: r => `${r} + ""` },
    { name: "cloned", look: r => `structuredClone(${r})` },
    { name: "from-entries", look: r => `Object.fromEntries(Object.entries(${r}))` },
    ...(shape.hasMethods
      ? [
          { name: "total", look: (r: string) => `${r}.total()` },
          { name: "total-plus", look: (r: string) => `${r}.total() + 1` },
          { name: "text", look: (r: string) => `${r}.text()` },
          { name: "text-length", look: (r: string) => `${r}.text().length` },
          { name: "method-taken-off", setup: (r: string) => `const taken = ${r}.total;`, look: () => "taken()", throws: true },
          { name: "method-on-itself", look: (r: string) => `${r}.total.call(${r})` },
        ]
      : []),
    ...(shape.isClass
      ? [
          { name: "instanceof", look: (r: string) => `${r} instanceof ${shape.name}` },
          { name: "prototype", look: (r: string) => `Object.getPrototypeOf(${r}) === ${shape.name}.prototype` },
          { name: "constructor", look: (r: string) => `${r}.constructor === ${shape.name}` },
        ]
      : []),
  ];
}

const read: Use = { name: "read", look: r => r };

const usesOf = (c: Case, type: Type): Use[] => [...usesOfKind(c, type), ...c.random.sample(type.kind === "function" ? typeTests.filter(use => use.name !== "is-truthy") : typeTests, 6)];

function usesOfKind(c: Case, type: Type): Use[] {
  switch (type.kind) {
    case "number":
      return numberUses;
    case "string":
      return stringUses;
    case "boolean":
      return booleanUses;
    case "inner":
      return innerUses(type.text);
    case "function":
      return functionUses;
    case "numbers":
      return arrayUses(true);
    case "texts":
      return arrayUses(false);
    case "enum":
      return enumUses(type.text);
    case "tuple":
      return tupleUses;
    case "union":
      return unionUses;
    case "maybe-inner":
    case "maybe-number":
    case "number-or-text":
      return unionFieldUses[type.kind];
    case "shape":
      return wholeUses(c, type.shape!);
  }
}

interface Observation {
  label: string;
  use: Use;
  on: string;
}

function observations(c: Case, type: Type, reference: Reference, focus: Field | undefined, mayThrow: boolean): Observation[] {
  const found: Observation[] = [];
  const isUsable = (use: Use, canStore: boolean) => c.isAllowed(use.name) && (canStore || !use.stores) && (mayThrow || !use.throws);
  const add = (prefix: string, use: Use, on: string) => found.push({ label: `${found.length + 1}:${prefix}${use.name}`, use, on });
  if (type.kind !== "shape") {
    add("", read, reference.text);
    for (const use of c.random.sample(usesOf(c, type).filter(use => isUsable(use, reference.canStore)), c.random.between(4, 12))) add("", use, reference.text); // prettier-ignore
    return found;
  }
  const shape = type.shape!;
  const ofField = (field: Field) => [...(field.isOptional ? optionalUses(field) : usesOf(c, field.type)), ...(field.hasWiderSetter ? [{ name: "text-stored", setup: (r: string) => `${r} = "12";`, look: (r: string) => r }] : [])].filter(use => isUsable(use, true)); // prettier-ignore
  const at = (field: Field) => `${reference.text}.${field.name}`;
  for (const field of shape.fields) add(field.name + ".", read, at(field));
  const later: (() => void)[] = [];
  if (focus) for (const use of c.random.sample(ofField(focus), c.random.between(3, 6))) later.push(() => add(focus.name + ".", use, at(focus)));
  for (let count = c.random.between(2, 7); count > 0; count--) {
    const field = c.random.pick(shape.fields);
    const use = c.random.pick(ofField(field));
    later.push(() => add(field.name + ".", use, at(field)));
  }
  for (const use of c.random.sample(usesOf(c, type).filter(use => isUsable(use, true)), c.random.between(3, 8))) later.push(() => add("", use, reference.text)); // prettier-ignore
  for (const each of c.random.shuffled(later)) each();
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The function that uses the victim.

export const places = ["parameter", "const-local", "let-local", "field", "static-field", "element", "tuple-element", "result", "module-variable", "literal-member", "nested-member"];
export const contexts = ["plain", "arrow", "loop", "try-finally", "closure", "nested-function", "callback", "method", "constructor", "getter", "async", "generator", "destructured-parameter", "rest-parameter", "default-parameter", "this-parameter"];
export const styles = ["closure", "deferred", "inline", "bare"];

interface Probe {
  text: string;
  isAsync: boolean;
  /** An expression of type string. */
  call: (victim: string, between?: string) => string;
}

function probeOf(c: Case, type: Type, focus: Field | undefined, hasBetween: boolean): Probe {
  const [place, context, style] = [c.random.pick(c.isUsedWhileConstructed ? places.filter(place => place !== "module-variable" && place !== "static-field") : places), c.random.pick(hasBetween ? contexts.filter(context => !context.endsWith("-parameter")) : contexts), c.random.weighted([[3, "closure"], [2, "deferred"], [3, "inline"], [2, "bare"]] as const)]; // prettier-ignore
  c.parts.push(`held in ${place}`, `used in ${context}`, `errors ${style}`);
  const T = type.text;
  const name = c.name("probe");
  let setup = "";
  let reference: Reference = { text: "v", canStore: true };
  if (place === "const-local") [setup, reference] = [`const local: ${T} = v;`, { text: "local", canStore: false }];
  if (place === "let-local") [setup, reference] = [`let local: ${T} = v;`, { text: "local", canStore: true }];
  if (place === "element") [setup, reference] = [`const list: ${T}[] = [v];`, { text: "list[0]", canStore: true }];
  if (place === "result") [setup, reference] = [`const give = (): ${T} => v;`, { text: "give()", canStore: false }];
  if (place === "literal-member") [setup, reference] = ["const bag = { held: v };", { text: "bag.held", canStore: true }];
  if (place === "tuple-element") [setup, reference] = [`const both: [${T}, number] = [v, 1];`, { text: "both[0]", canStore: true }];
  if (place === "nested-member") [setup, reference] = ["const deep = { within: { held: v } };", { text: "deep.within.held", canStore: true }];
  if (place === "static-field") {
    c.declare(c.late, "shelf", `class ${c.name("Shelf")} {\n  static held: ${T} = ${type.honest[0]};\n}`);
    [setup, reference] = [`${c.name("Shelf")}.held = v;`, { text: `${c.name("Shelf")}.held`, canStore: true }];
  }
  if (place === "field") {
    c.declare(c.top, "keeper", `class ${c.name("Keeper")} {\n  constructor(public held: ${T}) {}\n}`);
    [setup, reference] = [`const keeper = new ${c.name("Keeper")}(v);`, { text: "keeper.held", canStore: true }];
  }
  if (place === "module-variable") {
    c.declare(c.late, "current", `let ${c.name("current")}: ${T} = ${type.honest[0]};`);
    [setup, reference] = [`${c.name("current")} = v;`, { text: c.name("current"), canStore: true }];
  }

  const lines = observations(c, type, reference, focus, style !== "bare").map(({ label, use, on }) => {
    const [before, look] = [use.setup?.(on) ?? "", use.look(on)];
    if (style === "closure") return `out += "\\n${label} " + see(() => ${before ? `{ ${before} return ${look}; }` : look});`;
    if (style === "deferred") return `checks.push(["${label}", () => ${before ? `{ ${before} return ${look}; }` : look}]);`;
    if (style === "inline") return `try { ${before} out += "\\n${label} " + describe(${look}); } catch (error) { out += "\\n${label} " + errorName(error); }`.replace("{  ", "{ ");
    return before ? `{ ${before} out += "\\n${label} " + describe(${look}); }` : `out += "\\n${label} " + describe(${look});`;
  });
  const middle = lines.length >> 1;
  if (hasBetween) lines.splice(middle, 0, "between();");
  if (context === "async") lines.splice(middle, 0, "await Promise.resolve();");
  if (context === "generator") for (let at = lines.length; at > 0; at -= 2) lines.splice(at, 0, 'yield out; out = "";');

  const wrapped =
    context === "loop" ? ["for (let round = 0; round < 2; round++) {", ...lines.map(line => "  " + line), "}"]
    : context === "try-finally" ? ["try {", ...lines.map(line => "  " + line), "} finally {", '  out += "\\nfinally reached";', "}"]
    : context === "closure" ? ["const inner = (): void => {", ...lines.map(line => "  " + line), "};", "inner();"]
    : context === "nested-function" ? ["function inner(): void {", ...lines.map(line => "  " + line), "}", "inner();"]
    : context === "callback" ? ["[0].forEach(() => {", ...lines.map(line => "  " + line), "});"]
    : lines; // prettier-ignore
  const parameters = `v: ${T}${hasBetween ? ", between: () => void" : ""}`;
  const given = hasBetween ? "v, between" : "v";
  // The closures of the deferred style run when every one of them has been made.
  const [first, atLast] = style === "deferred" ? [["const checks: [string, () => unknown][] = [];"], [`for (const [label, run] of checks) out += "\\n" + label + " " + see(run);${context === "generator" ? " yield out;" : ""}`]] : [[], []];
  const body = (last: string) => ['let out = "";', ...first, ...(setup ? [setup] : []), ...wrapped, ...atLast, ...(last ? [last] : [])].map(line => `  ${line}\n`).join("");
  const text =
    context === "async" ? `async function ${name}(${parameters}): Promise<string> {\n${body("return out;")}}`
    : context === "arrow" ? `const ${name} = (${parameters}): string => {\n${body("return out;")}};`
    : context === "generator" ? `function* ${c.name("walk")}(${parameters}): Generator<string, void, undefined> {\n${body("")}}\nfunction ${name}(${parameters}): string {\n  let out = "";\n  for (const part of ${c.name("walk")}(${given})) out += part;\n  return out;\n}`
    : context === "method" ? `class ${c.name("Reader")} {\n  read(${parameters}): string {\n${body("return out;").replace(/^/gm, "  ").replace(/ +$/, "")}  }\n}\nconst ${c.name("reader")} = new ${c.name("Reader")}();\nfunction ${name}(${parameters}): string {\n  return ${c.name("reader")}.read(${given});\n}`
    : context === "destructured-parameter" ? `function ${c.name("inner")}({ held: v }: { held: ${T} }): string {\n${body("return out;")}}\nfunction ${name}(v: ${T}): string {\n  return ${c.name("inner")}({ held: v });\n}`
    : context === "rest-parameter" ? `function ${c.name("inner")}(...all: ${T}[]): string {\n  let v: ${T} = all[1];\n${body("return out;")}}\nfunction ${name}(v: ${T}): string {\n  return ${c.name("inner")}(v, v);\n}`
    : context === "default-parameter" ? `function ${c.name("inner")}(first: number, v: ${T} = ${type.honest[0]}): string {\n${body("return out;")}}\nfunction ${name}(v: ${T}): string {\n  return ${c.name("inner")}(1, v);\n}`
    : context === "this-parameter" ? `function ${c.name("inner")}(this: ${T}): string {\n  let v: ${T} = this;\n${body("return out;")}}\nfunction ${name}(v: ${T}): string {\n  return ${c.name("inner")}.call(v);\n}`
    : context === "constructor" ? `class ${c.name("Runner")} {\n  out: string;\n  constructor(${parameters}) {\n${body("this.out = out;").replace(/^/gm, "  ").replace(/ +$/, "")}  }\n}\nfunction ${name}(${parameters}): string {\n  return new ${c.name("Runner")}(${given}).out;\n}`
    : context === "getter" ? `class ${c.name("Looker")} {\n  constructor(\n    readonly seen: ${T},\n    readonly between: () => void,\n  ) {}\n  get out(): string {\n    let v: ${T} = this.seen;\n    const between = this.between;\n${body("return out;").replace(/^/gm, "  ").replace(/ +$/, "")}  }\n}\nfunction ${name}(${parameters}): string {\n  return new ${c.name("Looker")}(v, ${hasBetween ? "between" : "nothing"}).out;\n}`
    : `function ${name}(${parameters}): string {\n${body("return out;")}}`; // prettier-ignore
  const isAsync = context === "async";
  return { text, isAsync, call: (victim, between) => `${isAsync ? "await " : ""}${name}(${victim}${hasBetween ? `, ${between ?? "nothing"}` : ""})` };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Deliveries: a value of any kind reaches a position of the type.

type Then = (typed: string) => string;

interface Delivery {
  name: string;
  /** It brings a value of its own (undefined, mostly). */
  hasOwnValue?: boolean;
  carries?: (value: Value) => boolean;
  /** Statements of the case function. `raw` is a constant of type unknown and `honest` one of the type. Nothing where the type does not fit. */
  open(c: Case, type: Type, then: Then): string | undefined;
}

const classOf = (type: Type) => (type.shape?.isClass ? type.shape : undefined);
/** A class whose text a hole may add members to. */
const openClassOf = (type: Type) => (type.shape && classForms.includes(type.shape.form) ? type.shape : undefined);

export const deliveries: Delivery[] = [
  {
    name: "guard-lies",
    open(c, { text: T }, then) {
      c.top.push(`function ${c.name("isIt")}(value: unknown): value is ${T} {\n  return value !== ${c.name("taken")};\n}`);
      return `if (${c.name("isIt")}(raw)) {\n${then("raw")}\n}`;
    },
  },
  {
    name: "assertion-lies",
    open(c, { text: T }, then) {
      c.top.push(`function ${c.name("assertIt")}(value: unknown): asserts value is ${T} {\n  if (value === ${c.name("taken")}) throw new Error("never");\n}`);
      return `${c.name("assertIt")}(raw);\n${then("raw")}`;
    },
  },
  {
    name: "overload-wider",
    open(c, { text: T }, then) {
      c.top.push(`function ${c.name("convert")}(value: unknown): ${T};\nfunction ${c.name("convert")}(value: unknown): unknown {\n  return value;\n}`);
      return then(`${c.name("convert")}(raw)`);
    },
  },
  {
    name: "box-wider-view",
    open(c, { text: T }, then) {
      c.top.push(`class ${c.name("Box")}<V> {\n  constructor(public value: V) {}\n}`);
      return `const narrow = new ${c.name("Box")}<${T}>(honest);\nconst wide: ${c.name("Box")}<unknown> = narrow;\nwide.value = raw;\n${then("narrow.value")}`;
    },
  },
  {
    name: "array-wider-alias",
    open(c, { text: T }, then) {
      const start = `const narrow: ${T}[] = [honest];\nconst wide: unknown[] = narrow;\n`;
      return c.random.pick([
        `${start}wide.push(raw);\n${then("narrow[1]")}`,
        `${start}wide[0] = raw;\n${then("narrow[0]")}`,
        `${start}wide.unshift(raw);\nfor (const each of narrow) {\n${then("each")}\n}`,
        `${start}wide.push(raw);\nnarrow.forEach(each => {\n${then("each")}\n});`,
        `${start}wide.fill(raw);\nconst [first] = narrow;\n${then("first")}`,
      ]);
    },
  },
  {
    name: "map-wider-alias",
    open: (c, { text: T }, then) => `const narrow = new Map<string, ${T}>();\nconst wide: Map<string, unknown> = narrow;\nwide.set("key", raw);\nfor (const each of narrow.values()) {\n${then("each")}\n}`,
  },
  {
    name: "set-wider-alias",
    open: (c, { text: T }, then) => `const narrow = new Set<${T}>();\nconst wide: Set<unknown> = narrow;\nwide.add(raw);\nfor (const each of narrow) {\n${then("each")}\n}`,
  },
  {
    name: "record-wider-alias",
    open: (c, { text: T }, then) => `const narrow: Record<string, ${T}> = {};\nconst wide: Record<string, unknown> = narrow;\nwide.key = raw;\n${then("narrow.key")}`,
  },
  {
    name: "field-wider-alias",
    open(c, { text: T }, then) {
      c.top.push(`class ${c.name("Holder")} {\n  held: ${T};\n  constructor(held: ${T}) {\n    this.held = held;\n  }\n}`);
      return `const holder = new ${c.name("Holder")}(honest);\nconst wide: { held: unknown } = holder;\nwide.held = raw;\n${then("holder.held")}`;
    },
  },
  {
    name: "assign-over-a-field",
    open(c, { text: T }, then) {
      c.top.push(`class ${c.name("Holder")} {\n  held: ${T};\n  constructor(held: ${T}) {\n    this.held = held;\n  }\n}`);
      return `const holder = new ${c.name("Holder")}(honest);\n${c.random.pick(["Object.assign(holder, { held: raw });", 'Reflect.set(holder, "held", raw);', 'Object.defineProperty(holder, "held", { value: raw });'])}\n${then("holder.held")}`;
    },
  },
  {
    name: "method-bivariance",
    open(c, { text: T }, then) {
      c.top.push(`interface ${c.name("Taker")} {\n  take(value: unknown): void;\n}\nclass ${c.name("Strict")} implements ${c.name("Taker")} {\n  take(value: ${T}): void {\n${then("value")}\n  }\n}`);
      return `const taker: ${c.name("Taker")} = new ${c.name("Strict")}();\ntaker.take(raw);`;
    },
  },
  {
    name: "bivariant-callback-type",
    open(c, { text: T }, then) {
      c.top.push(`type ${c.name("Listener")} = { on(value: unknown): void }["on"];`);
      return `const strict = (value: ${T}): void => {\n${then("value")}\n};\nconst listener: ${c.name("Listener")} = strict;\nlistener(raw);`;
    },
  },
  {
    name: "optional-parameter-behind-a-shorter-signature",
    carries: value => value.name !== "undefined",
    open(c, { text: T }, then) {
      c.top.push(`function ${c.name("long")}(first: number, second?: ${T}): void {\n  if (second !== undefined) {\n${then("second")}\n  }\n}`);
      return `const short: (first: number) => void = ${c.name("long")};\nconst wide: (first: number, second: unknown) => void = short;\nwide(1, raw);`;
    },
  },
  { name: "result-of-reflect-get", open: (c, { text: T }, then) => `const bag = { held: raw };\nconst key: string = "held";\nconst typed: ${T} = Reflect.get(bag, key);\n${then("typed")}` },
  { name: "result-of-json-parse", carries: value => !!value.isJson, open: (c, { text: T }, then) => `const typed: ${T} = JSON.parse(JSON.stringify(raw));\n${then("typed")}` },
  { name: "value-of-a-descriptor", open: (c, { text: T }, then) => `const typed: ${T} = Object.getOwnPropertyDescriptor({ held: raw }, "held")?.value;\n${then("typed")}` },
  { name: "result-of-object-values", open: (c, { text: T }, then) => `const bag: object = { held: raw };\nconst typed: ${T} = Object.values(bag)[0];\n${then("typed")}` },
  { name: "result-of-the-function-type", open: (c, { text: T }, then) => `const give: Function = () => raw;\nconst typed: ${T} = ${c.random.pick(["give()", "Reflect.apply(give, undefined, [])"])};\n${then("typed")}` },
  { name: "index-out-of-range", hasOwnValue: true, open: (c, { text: T }, then) => `const list: ${T}[] = [honest];\n${then(c.random.pick(["list[3]", "list[-1]", "list[1.5]", "list[list.length]", "list[2 ** 32 - 1]", "list[2 ** 32]", "list[NaN]"]))}` },
  { name: "record-missing-key", hasOwnValue: true, open: (c, { text: T }, then) => `const record: Record<string, ${T}> = { here: honest };\n${then(c.random.pick(["record.missing", 'record["not here"]']))}` },
  { name: "read-before-assigned", hasOwnValue: true, open: (c, { text: T }, then) => `let late: ${T};\nconst readLate = (): ${T} => late;\n${then("readLate()")}\nlate = honest;` },
  {
    name: "array-of-holes",
    hasOwnValue: true,
    open: (c, { text: T }, then) => c.random.pick([`const list = new Array<${T}>(3);\n${then("list[1]")}`, `const list: ${T}[] = [honest];\nlist.length = 3;\n${then("list[2]")}`, `const list: ${T}[] = [honest, honest];\ndelete list[0];\n${then("list[0]")}`, `const list: ${T}[] = [];\nlist[2] = honest;\nfor (const each of list) {\n${then("each")}\n}`]), // prettier-ignore
  },
  {
    name: "yield-receives",
    open(c, { text: T }, then) {
      c.top.push(`function* ${c.name("listen")}(): Generator<undefined, void, ${T}> {\n  const got: ${T} = yield;\n${then("got")}\n}`);
      return c.random.pick([
        `const run = ${c.name("listen")}();\nconst wide: Generator<undefined, void, unknown> = run;\nwide.next();\nwide.next(raw);`,
        `const run = ${c.name("listen")}();\nrun.next();\nrun.next();`,
        `const walk: Iterable<undefined> = ${c.name("listen")}();\nfor (const nothing of walk) describe(nothing);`,
        `const walk: Iterable<undefined> = ${c.name("listen")}();\ndescribe([...walk]);`,
        `const walk: Iterable<undefined> = ${c.name("listen")}();\ndescribe(Array.from(walk));`,
      ]);
    },
  },
  {
    name: "thenable-resolves",
    open(c, type, then) {
      if (type.kind !== "shape") return;
      return `const carrier = ${c.random.chance(0.3) ? `Object.defineProperty(${type.honest[0]}, "then", { get: () => (resolve: (value: unknown) => void): void => resolve(raw) })` : `Object.assign(${type.honest[0]}, { then(resolve: (value: unknown) => void): void { resolve(raw); } })`};\nconst pass = async (value: ${type.text}): Promise<${type.text}> => value;\nconst typed: ${type.text} = await pass(carrier);\n${then("typed")}`;
    },
  },
  {
    name: "narrowing-undone-by-a-call",
    open: (c, type, then) => type.check && `const holder: { value: unknown } = { value: honest };\nconst swap = (): void => {\n  holder.value = raw;\n};\n${c.random.chance(0.3) ? `switch (true) {\n  case ${type.check("holder.value")}:\n    swap();\n${then("holder.value")}\n}` : `if (${type.check("holder.value")}) {\n  swap();\n${then("holder.value")}\n}`}`,
  },
  {
    name: "narrowing-undone-by-a-getter",
    open: (c, type, then) => type.check && `let reads = 0;\nconst holder = {\n  get value(): unknown {\n    return reads++ === 0 ? honest : raw;\n  },\n};\nif (${type.check("holder.value")}) {\n${then("holder.value")}\n}`,
  },
  {
    name: "narrowing-undone-by-an-await",
    open: (c, type, then) => type.check && `const holder: { value: unknown } = { value: honest };\nconst later = Promise.resolve().then(() => {\n  holder.value = raw;\n});\nif (${type.check("holder.value")}) {\n  await later;\n${then("holder.value")}\n}`,
  },
  {
    name: "has-instance-lies",
    open(c, type, then) {
      const shape = openClassOf(type);
      if (!shape) return;
      shape.members.push(`static [Symbol.hasInstance](value: unknown): boolean {\n    return value !== ${c.name("taken")};\n  }`);
      return `if (raw instanceof ${shape.name}) {\n${then("raw")}\n}`;
    },
  },
  {
    name: "is-array-of-unknown",
    carries: value => /array/.test(value.name),
    open: (c, type, then) => (type.kind === "numbers" || type.kind === "texts" ? `if (Array.isArray(raw)) {\n${then("raw")}\n}` : undefined),
  },
  {
    name: "declared-field-narrows-the-base",
    open(c, { text: T }, then) {
      c.top.push(`class ${c.name("Loose")} {\n  held: unknown;\n  constructor(held: unknown) {\n    this.held = held;\n  }\n}\nclass ${c.name("Tight")} extends ${c.name("Loose")} {\n  declare held: ${T};\n}`);
      return then(`new ${c.name("Tight")}(raw).held`);
    },
  },
  {
    name: "promise-wider-alias",
    open: (c, { text: T }, then) => `const narrow: Promise<${T}[]> = Promise.resolve([honest]);\nconst wide: Promise<unknown[]> = narrow;\n(await wide).push(raw);\nconst list = await narrow;\n${then("list[1]")}`,
  },
  {
    name: "in-narrowing-with-an-extra-member",
    open(c, { text: T }, then) {
      c.top.push(`type ${c.name("Has")} = { wanted: ${T} };\ntype ${c.name("Lacks")} = { other: number };`);
      return `const sneaky = { other: 1, wanted: raw };\nconst look = (either: ${c.name("Has")} | ${c.name("Lacks")}): void => {\n  if ("wanted" in either) {\n${then("either.wanted")}\n  }\n};\nlook(sneaky);`;
    },
  },
  {
    name: "forgotten-member-comes-back",
    carries: value => value.name !== "undefined",
    open: (c, { text: T }, then) => `const less: {} = { wanted: raw };\nconst again: { wanted?: ${T} } = less;\nif (again.wanted !== undefined) {\n${then("again.wanted")}\n}`,
  },
  {
    name: "abstract-member-read-by-the-base-constructor",
    hasOwnValue: true,
    open(c, { text: T }, then) {
      c.top.push(`abstract class ${c.name("Plan")} {\n  abstract held: ${T};\n  constructor() {\n    this.look();\n  }\n  look(): void {\n${then("this.held")}\n  }\n}\nclass ${c.name("Built")} extends ${c.name("Plan")} {\n  held: ${T};\n  constructor(held: ${T}) {\n    super();\n    this.held = held;\n  }\n}`);
      return `describe(new ${c.name("Built")}(honest));`;
    },
  },
  {
    name: "field-read-by-an-earlier-initializer",
    hasOwnValue: true,
    open(c, type, then) {
      c.top.push(`class ${c.name("Order")} {\n  first: ${type.text} = this.peek();\n  second: ${type.text} = ${type.honest[0]};\n  peek(): ${type.text} {\n    return this.second;\n  }\n}`);
      return then(`new ${c.name("Order")}().first`);
    },
  },
  {
    name: "enum-reverse-mapping-misses",
    hasOwnValue: true,
    open(c, type, then) {
      if (type.kind !== "string") return;
      const mode = c.mode().text;
      return `const loose: number = ${c.random.pick(["999", "-1", "1.5", "NaN"])};\n${then(`${mode}[loose]`)}`;
    },
  },
  {
    name: "character-out-of-range",
    hasOwnValue: true,
    open: (c, type, then) => (type.kind === "string" ? `const word: string = "ab";\n${then(c.random.pick(["word[5]", "word[-1]", "word[word.length]"]))}` : undefined),
  },
  {
    name: "enum-from-a-number",
    hasOwnValue: true,
    open(c, type, then) {
      if (type.kind !== "enum") return;
      return `const loose: number = ${c.random.pick(["999", "1.5", "-1", "NaN", "2 ** 31", "-0", `${type.text}.On | ${type.text}.Auto`, "3"])};\nconst typed: ${type.text} = loose;\n${then("typed")}`;
    },
  },
  {
    name: "this-is-another-value",
    open(c, type, then) {
      const shape = openClassOf(type);
      if (!shape || shape.form === "generic-class") return;
      shape.members.push(`inspect(): void {\n${then("this")}\n  }`);
      return c.random.pick([
        "honest.inspect.call(raw);",
        "honest.inspect.apply(raw);",
        "honest.inspect.bind(raw)();",
        "Reflect.apply(honest.inspect, raw, []);",
        "const taken = honest.inspect;\ntaken();",
        "const { inspect } = honest;\ninspect();",
        "const other = { inspect: honest.inspect };\nother.inspect();",
        "[0].forEach(honest.inspect, raw);",
        "(0, honest.inspect)();",
        "await Promise.resolve().then(honest.inspect);",
      ]);
    },
  },
  {
    name: "base-constructor-calls-an-override",
    hasOwnValue: true,
    open(c, type, then) {
      const shape = type.shape;
      if (!shape || !["class-fields", "class-fields-with-types", "private-beside"].includes(shape.form) || shape.heritage) return;
      c.early.push(`class ${c.name("Early")} {\n  constructor() {\n    this.ready();\n  }\n  ready(): void {}\n}`);
      shape.heritage = `extends ${c.name("Early")}`;
      c.isUsedWhileConstructed = true;
      shape.members.push(`ready(): void {\n${then("this")}\n  }`);
      return `describe(${shape.make});`;
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Impostors: an expression of the type whose value no constructor of the type made, or made in another way.

interface Impostor {
  name: string;
  /** `before` are statements, `value` an expression of the type. `honest` is a constant of the type. */
  make(c: Case, type: Type): { before?: string; value: string; after?: string; focus?: Field } | undefined;
}

const anyField = (c: Case, shape: Shape, accepts: (field: Field) => boolean = () => true) => {
  const fitting = shape.fields.filter(field => accepts(field) && !field.isNeverMade);
  return fitting.length ? c.random.pick(fitting) : undefined;
};
const hasOwnFunctions = (shape: Shape) => (!shape.isClass && shape.hasMethods) || shape.fields.some(field => field.type.kind === "function" && isStored(field));
const methodsAgain = (shape: Shape, from: string) => (shape.isClass && shape.hasMethods ? `, total: ${from}.total, text: ${from}.text` : "");
const loggingHandler = (log: string) =>
  `{\n  get(target, key, receiver) {\n    ${log}.push("get " + String(key));\n    return Reflect.get(target, key, receiver);\n  },\n  set(target, key, value, receiver) {\n    ${log}.push("set " + String(key));\n    return Reflect.set(target, key, value, receiver);\n  },\n` +
  `  has(target, key) {\n    ${log}.push("has " + String(key));\n    return Reflect.has(target, key);\n  },\n  ownKeys(target) {\n    ${log}.push("keys");\n    return Reflect.ownKeys(target);\n  },\n  getOwnPropertyDescriptor(target, key) {\n    ${log}.push("describe " + String(key));\n    return Reflect.getOwnPropertyDescriptor(target, key);\n  },\n` +
  `  getPrototypeOf(target) {\n    ${log}.push("prototype");\n    return Reflect.getPrototypeOf(target);\n  },\n}`;

const isObjectKind = (type: Type) => ["shape", "numbers", "texts", "tuple", "union", "inner"].includes(type.kind);

export const impostors: Impostor[] = [
  { name: "honest", make: (c, type) => ({ value: c.random.pick(type.honest) }) },
  { name: "proxy-that-forwards", make: (c, type) => (isObjectKind(type) || type.kind === "function" ? { value: `new Proxy(honest, {})` } : undefined) },
  {
    name: "proxy-that-logs",
    make(c, type) {
      if (!isObjectKind(type)) return;
      c.declare(c.early, "log", `const ${c.name("log")}: string[] = [];`);
      return { value: `new Proxy(honest, ${loggingHandler(c.name("log"))})`, after: `print("c${c.id}.traps " + ${c.name("log")}.join(" | "));` };
    },
  },
  {
    name: "proxy-that-answers",
    make(c, type) {
      const focus = type.shape && anyField(c, type.shape);
      if (!focus) return;
      return { focus, value: `new Proxy(honest, {\n  get(target, key, receiver) {\n    return key === "${focus.name}" ? ${wrongValue(c, focus.type).text} : Reflect.get(target, key, receiver);\n  },\n})` };
    },
  },
  { name: "proxy-that-is-revoked", make: (c, type) => (isObjectKind(type) ? { before: "const { proxy, revoke } = Proxy.revocable(honest, {});\nrevoke();", value: "proxy" } : undefined) },
  { name: "structured-clone", make: (c, type) => (isObjectKind(type) && !(type.shape && hasOwnFunctions(type.shape)) ? { value: "structuredClone(honest)" } : undefined) },
  { name: "spread-copy", make: (c, type) => (type.shape && !type.shape.isNominal ? { value: `{ ...honest${methodsAgain(type.shape, "honest")} }` } : undefined) },
  { name: "assign-copy", make: (c, type) => (type.shape ? { value: "Object.assign({}, honest)" } : undefined) },
  { name: "json-round-trip", make: (c, type) => (isObjectKind(type) ? { value: "JSON.parse(JSON.stringify(honest))" } : undefined) },
  { name: "created-from-the-prototype", make: (c, type) => (classOf(type) ? { value: `Object.create(${type.shape!.name}.prototype)` } : undefined) },
  { name: "created-from-an-instance", make: (c, type) => (isObjectKind(type) ? { value: "Object.create(honest)" } : undefined) },
  { name: "copy-without-a-prototype", make: (c, type) => (type.shape ? { value: "Object.assign(Object.create(null), honest)" } : undefined) },
  { name: "function-with-the-members", make: (c, type) => (type.shape ? { value: `Object.assign(${c.random.pick(["function () {}", "(): number => 0", "class {}"])}, honest)` } : undefined) },
  { name: "array-with-the-members", make: (c, type) => (type.shape ? { value: `Object.assign(${c.random.pick(["[]", "[1, 2]", "new Map()", "new Date(0)", "/x/"])}, honest)` } : undefined) },
  { name: "look-alike-class", make: (c, type) => (type.shape && !type.shape.isNominal ? { value: `new ${twinOf(c, type.shape, false)}()` } : undefined) },
  { name: "look-alike-with-accessors", make: (c, type) => (type.shape && !type.shape.isNominal ? { value: `new ${twinOf(c, type.shape, true)}()` } : undefined) },
  {
    name: "literal-for-a-class",
    make: (c, type) => (classOf(type) && !type.shape!.isNominal ? { value: literalOf([...type.shape!.fields].reverse(), ["total: (): number => -2", 'text: (): string => "literal"']) } : undefined),
  },
  {
    name: "literal-with-a-getter",
    make(c, type) {
      const focus = type.shape && !type.shape.isNominal ? anyField(c, type.shape, isStored) : undefined;
      if (!focus) return;
      const members = type.shape!.hasMethods ? ["total: (): number => -3", 'text: (): string => "getter"'] : [];
      return { focus, value: literalOf(type.shape!.fields.filter(field => field !== focus), [`get ${focus.name}(): ${focus.type.text} { return ${focus.initial}; }`, ...members]) };
    },
  },
  {
    name: "literal-with-only-a-setter",
    make(c, type) {
      const focus = type.shape && !type.shape.isNominal ? anyField(c, type.shape, isStored) : undefined;
      if (!focus) return;
      const members = type.shape!.hasMethods ? ["total: (): number => -3", 'text: (): string => "setter"'] : [];
      return { focus, value: literalOf(type.shape!.fields.filter(field => field !== focus), [`set ${focus.name}(value: ${focus.type.text}) { describe(value); }`, ...members]) };
    },
  },
  {
    name: "subclass-that-overrides",
    make(c, type) {
      const shape = classOf(type);
      if (!shape || shape.form === "generic-class") return;
      c.top.push(`class ${c.name("Heir")} extends ${shape.name} {\n  more = "more";\n  total(): number {\n    return super.total() + 100;\n  }\n}`);
      return { value: shape.make.replace(shape.name, c.name("Heir")) };
    },
  },
  {
    name: "partial-spread-over-it",
    make(c, type) {
      const focus = type.shape && !type.shape.isNominal ? anyField(c, type.shape, isStored) : undefined;
      if (!focus) return;
      return { focus, before: `const patch: Partial<${type.text}> = { ${focus.name}: undefined };`, value: `{ ...honest, ...patch${methodsAgain(type.shape!, "honest")} }` };
    },
  },
  { name: "frozen", make: (c, type) => (isObjectKind(type) ? { before: `const made: ${type.text} = ${type.honest[0]};\nObject.${c.random.pick(["freeze", "seal", "preventExtensions"])}(made);`, value: "made" } : undefined) },
  {
    name: "constructed-for-another-new-target",
    make(c, type) {
      const shape = classOf(type);
      if (!shape) return;
      const given = /\((.*)\)$/.exec(shape.make)![1];
      return { value: `Reflect.construct(${shape.name}, [${given}], ${c.random.pick([c.stranger(), "Object", "Array", "function () {}"])})` };
    },
  },
  {
    name: "field-declared-by-a-merged-interface",
    make: (c, type) => neverMade(c, type, "merged-interface"),
  },
  {
    name: "field-declared-and-never-made",
    make: (c, type) => neverMade(c, type, "declared-field"),
  },
  {
    name: "base-constructor-returns-another-object",
    make(c, type) {
      const shape = type.shape;
      if (!shape || !["class-fields", "class-fields-with-types", "private-beside"].includes(shape.form) || shape.heritage) return;
      c.early.push(`class ${c.name("Returner")} {\n  constructor(other: object) {\n    return other;\n  }\n}`);
      shape.heritage = `extends ${c.name("Returner")}`;
      shape.make = `new ${shape.name}({})`;
      type.honest = [shape.make];
      return { value: `new ${shape.name}(${c.random.pick(["[]", `new ${c.stranger()}()`, "Object.create(null)", "function () {}", "new Proxy({}, {})", "Object.freeze({})", "new Map()", "{ added: 1 }"])})` };
    },
  },
  { name: "instance-of-a-second-evaluation", make: (c, type) => (type.shape?.form === "factory-class" ? { value: `new (${c.name("define")}())()` } : undefined) },
  { name: "extends-parameter", make: (c, type) => (type.shape?.form === "extends-parameter" ? { value: type.shape.make } : undefined) },
  { name: "three-mixins", make: (c, type) => (type.shape?.form === "three-mixins" ? { value: type.shape.make } : undefined) },
  {
    name: "array-subclass",
    make(c, type) {
      if (type.kind !== "numbers") return;
      c.top.push(`class ${c.name("Stack")} extends Array<number> {\n  push(...items: number[]): number {\n    return super.push(...items.map(each => each * 10));\n  }\n  at(index: number): number | undefined {\n    return -index;\n  }\n}`);
      return { before: `const stack = new ${c.name("Stack")}();\nstack.push(1, 2, 3);`, value: "stack" };
    },
  },
  { name: "array-made-with-a-length", make: (c, type) => (type.kind === "numbers" || type.kind === "texts" ? { value: c.random.pick([`new Array<${type.text.slice(0, -2)}>(3)`, `Array<${type.text.slice(0, -2)}>(2)`]) } : undefined) },
  { name: "array-with-members", make: (c, type) => (type.kind === "numbers" || type.kind === "texts" ? { value: `Object.assign(${type.honest[0]}, { extra: 1 })` } : undefined) },
  {
    name: "primitive-for-an-object-type",
    make(c, type) {
      if (type.shape?.form !== "thin") return;
      return { value: c.random.pick(['spell("ab")', "[1, 2]", "(first: number, second: number): number => first + second", 'Object("ab")']) };
    },
  },
];

function neverMade(c: Case, type: Type, how: "merged-interface" | "declared-field") {
  const shape = openClassOf(type);
  if (!shape || shape.form === "generic-class") return;
  const focus = drawField(c, c.random.pick(["number", "string", "boolean", "inner", "function", "numbers", "enum"]), new Set(shape.fields.map(field => field.name)));
  if (!focus) return;
  focus.isNeverMade = how;
  shape.fields.push(focus);
  return { focus, value: shape.make };
}

/** `{ length: number }`, which a string, an array and a function satisfy. */
function thinShape(c: Case): Shape {
  const name = c.name("Sized");
  const fields: Field[] = [{ name: "length", type: numberType(true), initial: "2" }];
  return { name, typeText: name, form: "thin", fields, isClass: false, isNominal: false, hasMethods: false, make: "{ length: 2 }", members: [], render: () => `interface ${name} {\n  length: number;\n}` };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Mutations: an honest object is changed behind its type.

interface Mutation {
  name: string;
  /** Statements that change what `ref`, an expression of the type, refers to. */
  change(c: Case, type: Type): { focus?: Field; change: (ref: string) => string } | undefined;
}

/** A mutation of one field of an object type. */
const onField =
  (accepts: (field: Field, shape: Shape) => boolean, change: (c: Case, field: Field, shape: Shape) => (ref: string) => string): Mutation["change"] =>
  (c, type) => {
    const focus = type.shape && anyField(c, type.shape, field => accepts(field, type.shape!));
    return focus ? { focus, change: change(c, focus, type.shape!) } : undefined;
  };
const every = () => true;
const another = (c: Case, field: Field) => c.random.pick(field.type.honest);
const onArray =
  (change: (c: Case, isNumbers: boolean) => (ref: string) => string): Mutation["change"] =>
  (c, type) => {
    if (type.kind === "numbers" || type.kind === "texts") return { change: change(c, type.kind === "numbers") };
    const focus = type.shape && anyField(c, type.shape, field => (field.type.kind === "numbers" || field.type.kind === "texts") && isStored(field));
    if (!focus) return;
    const inner = change(c, focus.type.kind === "numbers");
    return { focus, change: ref => inner(`${ref}.${focus.name}`) };
  };
const onClass =
  (change: (c: Case, shape: Shape) => (ref: string) => string): Mutation["change"] =>
  (c, type) =>
    classOf(type) ? { change: change(c, type.shape!) } : undefined;
const onObject =
  (change: (c: Case) => (ref: string) => string): Mutation["change"] =>
  (c, type) =>
    isObjectKind(type) ? { change: change(c) } : undefined;

/** The name of the field as a constant, or put together while the program runs. */
const keyOf = (c: Case, field: Field) => (c.random.chance(0.4) ? `spell("${field.name}")` : `"${field.name}"`);
const memberOf = (c: Case, field: Field) => (c.random.chance(0.4) ? `[spell("${field.name}")]` : field.name);

export const mutations: Mutation[] = [
  { name: "store-through-an-unknown-alias", change: onField(every, (c, field) => ref => `const wide: { ${field.name}${field.isOptional ? "?" : ""}: unknown } = ${ref};\nwide.${field.name} = ${wrongValue(c, field.type).text};`) },
  {
    name: "store-through-a-union-alias",
    change: onField(
      field => !field.isOptional,
      (c, field) => {
        const value = wrongValue(c, field.type, each => !!each.type);
        return ref => `const wide: { ${field.name}: ${field.type.text} | ${value.type} } = ${ref};\nwide.${field.name} = ${value.text};`;
      },
    ),
  },
  { name: "delete-through-an-optional-alias", change: onField(every, (c, field) => ref => `const loose: { ${field.name}?: ${field.type.text} } = ${ref};\ndelete loose.${field.name};`) },
  { name: "undefined-through-an-optional-alias", change: onField(every, (c, field) => ref => `const loose: { ${field.name}?: ${field.type.text} } = ${ref};\nloose.${field.name} = undefined;`) },
  { name: "define-another-value", change: onField(every, (c, field) => ref => `Object.defineProperty(${ref}, ${keyOf(c, field)}, { value: ${wrongValue(c, field.type).text}, writable: true, enumerable: true, configurable: true });`) },
  { name: "define-a-getter-of-another-type", change: onField(every, (c, field) => ref => `Object.defineProperty(${ref}, ${keyOf(c, field)}, { get: () => ${wrongValue(c, field.type).text}, enumerable: true, configurable: true });`) },
  {
    name: "define-a-getter-of-the-type",
    change: onField(isStored, (c, field) => {
      c.declare(c.early, "log", `const ${c.name("log")}: string[] = [];`);
      return ref => `Object.defineProperty(${ref}, "${field.name}", {\n  get() {\n    ${c.name("log")}.push("get");\n    return ${another(c, field)};\n  },\n  set(value: unknown) {\n    ${c.name("log")}.push("set " + describe(value));\n  },\n  enumerable: true,\n  configurable: true,\n});`;
    }),
  },
  {
    name: "define-a-getter-that-alternates",
    change: onField(isStored, (c, field) => {
      c.declare(c.early, "turns", `let ${c.name("turns")} = 0;`);
      return ref => `Object.defineProperty(${ref}, "${field.name}", { get: () => (${c.name("turns")}++ % 2 ? ${wrongValue(c, field.type).text} : ${another(c, field)}), enumerable: true, configurable: true });`;
    }),
  },
  { name: "define-read-only", change: onField(isStored, (c, field) => ref => `Object.defineProperty(${ref}, ${keyOf(c, field)}, { value: ${another(c, field)}, writable: false });`) },
  { name: "define-not-enumerable", change: onField(isStored, (c, field) => ref => `Object.defineProperty(${ref}, ${keyOf(c, field)}, { enumerable: false });`) },
  { name: "assign-another-value", change: onField(every, (c, field) => ref => `Object.assign(${ref}, { ${memberOf(c, field)}: ${wrongValue(c, field.type).text} });`) },
  { name: "reflect-set-another-value", change: onField(every, (c, field) => ref => `Reflect.set(${ref}, ${keyOf(c, field)}, ${wrongValue(c, field.type).text});`) },
  { name: "reflect-delete", change: onField(every, (c, field) => ref => `Reflect.deleteProperty(${ref}, ${keyOf(c, field)});`) },
  { name: "reflect-define-another-value", change: onField(every, (c, field) => ref => `Reflect.defineProperty(${ref}, ${keyOf(c, field)}, { value: ${wrongValue(c, field.type).text} });`) },
  {
    name: "generic-store-with-a-union-key",
    change(c, type) {
      const shape = type.shape;
      if (!shape) return;
      const [focus, donor] = c.random.shuffled(shape.fields.filter(field => isStored(field) && !field.isGeneric));
      if (!donor || donor.type.kind === focus.type.kind) return;
      c.top.push(`function ${c.name("put")}<O, K extends keyof O>(target: O, key: K, value: O[K]): void {\n  target[key] = value;\n}\nfunction ${c.name("choose")}(): "${focus.name}" | "${donor.name}" {\n  return "${focus.name}";\n}`);
      return { focus, change: ref => `${c.name("put")}(${ref}, ${c.name("choose")}(), ${donor.initial});` };
    },
  },
  {
    name: "another-member-of-the-union-arrives",
    change: onField(
      field => !!field.type.others && isStored(field),
      (c, field) => {
        const value = c.random.pick(field.type.others!);
        return ref =>
          c.random.pick([
            `Object.assign(${ref}, { ${memberOf(c, field)}: ${value} });`,
            `Reflect.set(${ref}, ${keyOf(c, field)}, ${value});`,
            `Object.defineProperty(${ref}, "${field.name}", { value: ${value}, writable: true, enumerable: true, configurable: true });`,
            `${ref}.${field.name} = ${value};`,
            `const name: "${field.name}" = "${field.name}";\n${ref}[name] = ${value};`,
            `for (const [name] of Object.entries(${ref})) if (name === "${field.name}") Reflect.set(${ref}, name, ${value});`,
            `Object.assign(${ref}, JSON.parse(JSON.stringify({ ${field.name}: ${value === "undefined" ? "null" : value} })));`,
          ]);
      },
    ),
  },
  { name: "unusual-number-stored", change: onField(field => field.type.kind === "number" && !field.isOptional, c => { const value = c.random.pick(["-0", "NaN", "2 ** 31", "2 ** 53", "-(2 ** 31) - 1", "0.1", "Infinity", "1e21"]); return ref => `${ref} = ${value};`; }) }, // prettier-ignore
  { name: "prototype-to-null", change: onObject(() => ref => `Object.setPrototypeOf(${ref}, null);`) },
  { name: "prototype-to-a-stranger", change: onObject(c => ref => `${c.random.pick(["Object", "Reflect"])}.setPrototypeOf(${ref}, ${c.stranger()}.prototype);`) },
  { name: "prototype-to-a-literal", change: onObject(() => ref => `Reflect.setPrototypeOf(${ref}, {\n  total() {\n    return -4;\n  },\n  inherited: "from a literal",\n});`) },
  { name: "prototype-to-a-proxy", change: onObject(() => ref => `Object.setPrototypeOf(${ref}, new Proxy(Object.getPrototypeOf(${ref}) ?? {}, {}));`) },
  { name: "frozen-later", change: onObject(c => ref => `Object.${c.random.pick(["freeze", "seal", "preventExtensions"])}(${ref});`) },
  { name: "own-member-over-a-method", change: (c, type) => (type.shape?.hasMethods ? { change: ref => `${ref}.total = ${c.random.pick(["(): number => 5", "function (): number {\n  return 6;\n}", `${ref}.total.bind(${type.honest[0]})`])};` } : undefined) },
  { name: "prototype-method-replaced", change: onClass((c, shape) => () => `${shape.name}.prototype.total = function (): number {\n  return 7;\n};`) },
  { name: "class-prototype-re-parented", change: onClass((c, shape) => () => `Object.setPrototypeOf(${shape.name}.prototype, ${c.random.pick([`${c.stranger()}.prototype`, "null", "{ inherited: 1 }", "Array.prototype"])});`) },
  { name: "own-getter-over-a-method", change: (c, type) => (type.shape?.hasMethods ? { change: ref => `Object.defineProperty(${ref}, "total", { get: () => (): number => 8, configurable: true });` } : undefined) },
  { name: "prototype-method-deleted", change: onClass((c, shape) => () => `Reflect.deleteProperty(${shape.name}.prototype, "total");`) },
  { name: "prototype-gets-an-accessor-under-a-field", change: (c, type) => { const focus = classOf(type) && anyField(c, type.shape!, isStored); return focus ? { focus, change: () => `Object.defineProperty(${type.shape!.name}.prototype, "${focus.name}", { get: () => ${wrongValue(c, focus.type).text}, set() {}, configurable: true });` } : undefined; } }, // prettier-ignore
  { name: "member-added", change: onObject(c => ref => c.random.pick([`Object.assign(${ref}, { added: 1 });`, `Reflect.set(${ref}, "added", "later");`, `Reflect.set(${ref}, "0", "zero");`, `Reflect.set(${ref}, Symbol.for("added"), 1);`, `Object.defineProperty(${ref}, "hidden", { value: 1 });`])) },
  { name: "members-deleted-and-stored-again", change: (c, type) => (type.shape ? { change: ref => `for (const [key, value] of Object.entries(${ref}).reverse()) {\n  Reflect.deleteProperty(${ref}, key);\n  Reflect.set(${ref}, key, value);\n}` } : undefined) },
  { name: "conversion-members-planted", change: (c, type) => (type.shape ? { change: ref => `Object.assign(${ref}, {\n  toString(): string {\n    return "planted";\n  },\n  toJSON(): unknown {\n    return { planted: true };\n  },\n});` } : undefined) },
  { name: "inner-object-changed", change: onField(field => field.type.kind === "inner" && isStored(field), c => ref => c.random.pick([`Object.setPrototypeOf(${ref}, null);`, `const wide: { depth: unknown } = ${ref};\nwide.depth = "deep";`, `Reflect.deleteProperty(${ref}, "depth");`, `Object.freeze(${ref});`, `${ref}.twice = (): number => -5;`])) }, // prettier-ignore
  { name: "element-of-another-kind", change: onArray((c, isNumbers) => ref => `const wide: unknown[] = ${ref};\n${c.random.pick(["wide.push(", "wide[0] = (", "wide[1] = (", "wide.unshift("])}${c.random.pick([isNumbers ? '"text"' : "7", "undefined", "null", "{}", "[1]", "10n"])});`) },
  { name: "unusual-number-in-an-array", change: (c, type) => { const found = onArray(() => ref => c.random.pick([`${ref}.push(`, `${ref}[0] = (`, `${ref}.unshift(`, `${ref}[${ref}.length] = (`]) + c.random.pick(["0.5", "NaN", "-0", "2 ** 31", "-(2 ** 31) - 1", "2 ** 53", "Infinity", "1e21"]) + ");")(c, type); return found && (found.focus ? found.focus.type.kind === "numbers" : type.kind === "numbers") ? found : undefined; } }, // prettier-ignore
  { name: "holes-made", change: onArray((c, isNumbers) => ref => c.random.pick([`${ref}.length = 6;`, `delete ${ref}[1];`, `${ref}[8] = ${isNumbers ? "1" : '"far"'};`, `Reflect.deleteProperty(${ref}, "0");`])) },
  { name: "element-accessor", change: onArray((c, isNumbers) => ref => `Object.defineProperty(${ref}, "${c.random.pick(["0", "1"])}", { get: () => ${c.random.pick([isNumbers ? "9" : '"got"', isNumbers ? '"text"' : "9", "undefined"])}, configurable: true });`) },
  { name: "array-locked", change: onArray(c => ref => c.random.pick([`Object.freeze(${ref});`, `Object.seal(${ref});`, `Object.preventExtensions(${ref});`, `Object.defineProperty(${ref}, "length", { writable: false });`])) },
  { name: "array-own-method", change: onArray((c, isNumbers) => ref => c.random.pick([`${ref}.push = (): number => -1;`, `${ref}.map = () => [];`, `${ref}.join = (): string => "own join";`, `${ref}[Symbol.iterator] = () => [${isNumbers ? "-7" : '"own"'}].values();`, `${ref}.at = () => undefined;`, `Reflect.set(${ref}, Symbol.isConcatSpreadable, false);`])) },
  { name: "array-prototype-changed", change: onArray(c => ref => c.random.pick([`Object.setPrototypeOf(${ref}, null);`, `Object.setPrototypeOf(${ref}, { inherited: 1 });`, `Object.setPrototypeOf(${ref}, Object.create(Array.prototype, { 1: { value: "inherited element", configurable: true } }));`])) },
  { name: "tuple-loses-its-form", change: (c, type) => (type.kind === "tuple" ? { change: ref => c.random.pick([`${ref}.push("more");`, `${ref}.sort();`, `${ref}.reverse();`, `${ref}.pop();`, `${ref}.shift();`, `${ref}.splice(0, 1);`, `${ref}.fill("filled");`, `${ref}.unshift("front");`, `${ref}.copyWithin(0, 1);`]) } : undefined) },
  {
    name: "tag-stored-alone",
    change(c, type) {
      if (type.kind !== "union") return;
      c.top.push(`function ${c.name("retag")}(figure: ${type.text}): void {\n  figure.kind = figure.kind === "circle" ? "square" : "circle";\n}`);
      return { change: ref => `${c.name("retag")}(${ref});` };
    },
  },
];

// `unusual-number-stored` and `inner-object-changed` act on the field itself.
for (const name of ["unusual-number-stored", "inner-object-changed"]) {
  const mutation = mutations.find(each => each.name === name)!;
  const whole = mutation.change;
  mutation.change = (c, type) => {
    const found = whole(c, type);
    return found?.focus ? { focus: found.focus, change: ref => found.change(`${ref}.${found.focus!.name}`) } : undefined;
  };
}

export const holes: string[] = [...deliveries, ...impostors, ...mutations].map(hole => hole.name);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A case and a program.

const prelude = `function print(text: string): void {
  console.log(text);
}
function describe(value: unknown, depth: number = 0): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return value.includes("=>") || value.includes("function") || value.includes("class ") ? "string with the text of a function" : "string " + JSON.stringify(value);
  if (typeof value === "boolean") return "boolean " + String(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol " + String(value.description);
  if (typeof value === "function") return "function of " + value.length;
  if (typeof value !== "object") return "something else";
  if (value === null) return "null";
  if (depth > 1) return Array.isArray(value) ? "array" : "object";
  const parts: string[] = [];
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length && index < 8; index++) parts.push(index in value ? describe(value[index], depth + 1) : "hole");
    return "array of " + value.length + " [" + parts.join(", ") + "]";
  }
  for (const key of Object.keys(value)) parts.push(key + ": " + describe(Reflect.get(value, key), depth + 1));
  return "object {" + parts.join(", ") + "}";
}
function errorName(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
}
function see(run: () => unknown): string {
  try {
    return describe(run());
  } catch (error) {
    return errorName(error);
  }
}
function report(stage: string, text: string): void {
  for (const line of text.split("\\n")) if (line) print(stage + "." + line);
}
function nothing(): void {}
function spell(text: string): string {
  return text.split("").join("");
}
const table: number[] = [10, 20, 30];
const lookup: Record<string, number> = { ab: 1, cd: 2, text: 3 };
`;

// What the compiler believes about a built-in function is the sum of what every call in the program tells it, and a describe() that lists the keys of whatever it is given tells it a lot.
// A lean program has one that asks for the kind and the text of a value and for nothing else, so that a false belief is not hidden by the program's own way of printing.
const leanPrelude = prelude.replace(
  /function describe\([\s\S]*?\n}\n/,
  `function describe(value: unknown, depth: number = 0): string {
  if (typeof value === "function") return "function";
  if (Object.is(value, -0)) return "number -0";
  const text = String(value);
  return typeof value + " " + (text.includes("=>") || text.includes("function") || text.includes("class ") ? "with the text of a function" : text);
}
`,
);

const indented = (text: string, by = "  ") => text.replace(/^(?=.)/gm, by);

function drawType(c: Case, wantedForms?: string[], wantedKinds?: Kind[]): Type {
  if (wantedForms) return shapeType(wantedForms[0] === "thin" ? thinShape(c) : drawShape(c, wantedForms));
  const kind = wantedKinds ? c.random.pick(wantedKinds) : c.random.weighted([[24, "shape"], [3, "number"], [3, "string"], [4, "numbers"], [1, "texts"], [2, "function"], [2, "enum"], [2, "tuple"], [1, "boolean"], [1, "inner"], [2, "union"]] as const); // prettier-ignore
  switch (kind) {
    case "shape":
      return shapeType(drawShape(c));
    case "number":
      return numberType(c.random.chance(0.5));
    case "string":
      return stringType;
    case "numbers":
      return numbersType;
    case "texts":
      return textsType;
    case "function":
      return c.step();
    case "enum":
      return c.mode();
    case "tuple":
      return c.pair();
    case "boolean":
      return booleanType;
    case "inner":
      return c.inner();
    case "union":
      return c.figure();
  }
}

const formsFor: Record<string, string[]> = { "instance-of-a-second-evaluation": ["factory-class"], "extends-parameter": ["extends-parameter"], "three-mixins": ["three-mixins"], "primitive-for-an-object-type": ["thin"] };

const arrays: Kind[] = ["numbers", "numbers", "texts", "shape"];
/** The kinds of types that a hole is about, where it is not about all of them. */
const kindsFor: Record<string, Kind[]> = {
  "tag-stored-alone": ["union"],
  "inner-object-changed": ["shape"],
  "another-member-of-the-union-arrives": ["shape"],
  "tuple-loses-its-form": ["tuple"],
  "enum-from-a-number": ["enum"],
  "enum-reverse-mapping-misses": ["string"],
  "character-out-of-range": ["string"],
  "is-array-of-unknown": ["numbers", "texts"],
  "array-subclass": ["numbers"],
  "array-made-with-a-length": ["numbers", "texts"],
  "array-with-members": ["numbers", "texts"],
  "element-of-another-kind": arrays,
  "holes-made": arrays,
  "unusual-number-in-an-array": ["numbers", "shape"],
  "element-accessor": arrays,
  "array-locked": arrays,
  "array-own-method": arrays,
  "array-prototype-changed": arrays,
};

const fieldFor: Record<string, string[]> = { "another-member-of-the-union-arrives": ["maybe-inner", "maybe-number", "number-or-text"], "inner-object-changed": ["inner"], ...Object.fromEntries(Object.entries(kindsFor).flatMap(([hole, kinds]) => (kinds === arrays ? [[hole, ["numbers", "texts"]]] : []))), "unusual-number-in-an-array": ["numbers"] };

interface Built {
  text: string;
  parts: string[];
}

function attempt(id: number, stage: string, statements: string) {
  return `try {\n${indented(statements)}\n} catch (error) {\n  print("c${id}.${stage} " + errorName(error));\n}`;
}

function caseOf(id: number, random: Random, hole: string, isAllowed: (part: string) => boolean): Built | undefined {
  const c = new Case(id, random, isAllowed);
  if (fieldFor[hole]) c.wantedField = random.pick(fieldFor[hole]);
  const type = drawType(c, formsFor[hole], kindsFor[hole]);
  const T = type.text;
  const taken = c.name("taken");
  const then: Then = typed => `${taken}.push(${c.name("probe")}(${typed}));`;
  c.early.push(`const ${taken}: (string | Promise<string>)[] = [];`);
  c.parts.push(hole, type.shape ? type.shape.form : type.kind);

  const delivery = deliveries.find(each => each.name === hole);
  const impostor = impostors.find(each => each.name === hole);
  const mutation = mutations.find(each => each.name === hole);
  const flush = `for (const each of await Promise.allSettled(${taken}.splice(0))) report("c${id}.victim", each.status === "fulfilled" ? each.value : "\\nprobe " + errorName(each.reason));`;
  const body: string[] = [];
  let focus: Field | undefined;
  let probe: Probe;
  const warmUp = (object: string, time: string) => {
    if (time === "after-2000") body.push(`let warm = 0;\nfor (let turn = 0; turn < 2000; turn++) warm += (${probe.call(object)}).length;\nprint("c${id}.warm " + warm);`);
    if (time === "other-call-sites") body.push(`report("c${id}.honest-first", ${probe.call(object)});\nreport("c${id}.honest-second", ${probe.call(type.honest[0])});`);
  };

  if (mutation) {
    const found = mutation.change(c, type);
    if (!found) return;
    focus = found.focus;
    const time = random.pick(["first", "after-2000", "after-2000", "mid-loop", "mid-body", "mid-body-after-2000"]);
    const isInCallee = random.chance(0.3);
    // A second change behind the same reference, now and then.
    const second = random.chance(0.15) ? random.pick(mutations.filter(each => isAllowed(each.name) && each !== mutation)) : undefined;
    const more = second?.change(c, type);
    if (more) c.parts.push(`and ${second!.name}`);
    c.parts.push(time, isInCallee ? "changed in a callee" : "changed in place");
    probe = probeOf(c, type, focus, time.startsWith("mid-body"));
    const changes = (ref: string) => `{\n${indented(found.change(ref))}\n}${more ? `\n{\n${indented(more.change(ref))}\n}` : ""}`;
    if (isInCallee) c.top.push(`function ${c.name("alter")}(target: ${T}): void {\n${indented(changes("target"))}\n}`);
    const change = attempt(id, "change", isInCallee ? `${c.name("alter")}(victim);` : changes("victim"));
    body.push(`const victim: ${T} = ${random.pick(type.honest)};`);
    if (time === "after-2000" || time === "mid-body-after-2000") warmUp("victim", "after-2000");
    if (time === "mid-loop") body.push(attempt(id, "loop", `let last = "";\nfor (let turn = 0; turn < 2000; turn++) {\n  if (turn === 1990) {\n${indented(change, "    ")}\n  }\n  last = ${probe.call("victim")};\n}\nreport("c${id}.after", last);`));
    else if (time.startsWith("mid-body")) body.push(attempt(id, "during", `report("c${id}.during", ${probe.call("victim", `() => {\n${indented(change)}\n}`)});`), attempt(id, "after", `report("c${id}.after", ${probe.call("victim")});`));
    else body.push(...(time === "first" ? [] : [attempt(id, "before", `report("c${id}.before", ${probe.call("victim")});`)]), change, attempt(id, "after", `report("c${id}.after", ${probe.call("victim")});`));
    body.push(attempt(id, "fresh", `report("c${id}.fresh", ${probe.call(type.honest[0])});`));
    if (c.early.some(line => line.startsWith(`const ${c.name("log")}`))) body.push(`print("c${id}.log " + ${c.name("log")}.length + " entries, the last: " + ${c.name("log")}.slice(-12).join(" | "));`);
    if (c.early.some(line => line.startsWith(`let ${c.name("turns")}`))) body.push(`print("c${id}.reads-of-the-getter " + ${c.name("turns")});`);
  } else {
    const time = random.pick(["first", "after-2000", "after-2000", "other-call-sites"]);
    let arrival: string;
    if (delivery) {
      const value = delivery.hasOwnValue ? undefined : wrongValue(c, type, delivery.carries);
      const opened = delivery.open(c, type, then);
      if (!opened) return;
      const way = value && random.pick(arrivals.filter(each => !each.fits || each.fits(value)));
      if (value) c.parts.push(value.name, way!.name);
      arrival = `${value ? `const raw: unknown = ${way!.from(value.text)};\n` : ""}${opened}`;
    } else {
      const made = impostor!.make(c, type);
      if (!made) return;
      focus = made.focus;
      const second = random.chance(0.15) ? random.pick(mutations.filter(each => isAllowed(each.name))) : undefined;
      const more = second?.change(c, type);
      if (more) c.parts.push(`and ${second!.name}`);
      arrival = `${made.before ? made.before + "\n" : ""}const victim: ${T} = ${made.value};\n${more ? `{\n${indented(more.change("victim"))}\n}\n` : ""}${then("victim")}${made.after ? `\n${flush}\n${made.after}` : ""}`;
    }
    c.parts.push(time);
    probe = probeOf(c, type, focus, false);
    body.push(`const honest: ${T} = ${random.pick(type.honest)};`);
    // What a constructor of the type itself hands to the probe comes first.
    body.push(flush.replace(".victim", ".early"));
    warmUp("honest", time);
    body.push(attempt(id, "arrival", arrival), flush, attempt(id, "honest-after", `report("c${id}.honest-after", ${probe.call("honest")});`));
  }

  body.push(`print("c${id}.conversions " + ${c.conversions()}.length + ": " + ${c.conversions()}.slice(0, 40).join(" "));`);
  if (type.shape) c.top.unshift(`function ${c.name("helper")}(given: ${T}): number {\n  return (${sumOf(type.shape.fields, "given")}) * 2;\n}\nfunction ${c.name("scaled")}(given: ${T}, by: number): number {\n  return (${sumOf(type.shape.fields, "given")}) * by;\n}`);
  const helperCalls = type.shape ? `print("c${id}.helper " + ${c.name("helper")}(${type.honest[0]}));\n` : "";
  const text = [
    ...c.early,
    ...(type.shape ? [type.shape.render()] : []),
    ...c.top,
    probe.text,
    ...c.late,
    `async function ${c.name("case")}(): Promise<void> {\n  print(${JSON.stringify(`c${id} # ${c.parts.join(", ")}`)});\n${indented(helperCalls + body.join("\n"))}\n}`,
  ].join("\n");
  return { text: text + "\n", parts: c.parts };
}

export interface Options {
  /** Draws the parts that `filed` lists too. */
  withFiled?: boolean;
  /** The holes to draw from. */
  holes?: string[];
  /** How many cases a program has; one to four where absent, one or two in a lean program. */
  cases?: number;
  /** Whether the program prints with the lean describe(); one program in three where absent. */
  isLean?: boolean;
}

export interface Program {
  hole: string;
  text: string;
  /** What each case is put together from. */
  parts: string[][];
  /** Each case as a program of its own, with the lines it prints in the whole. */
  alone: string[];
}

const runs = (ids: number[]) => ids.map(id => `try {\n  await case${id}();\n} catch (error) {\n  print("c${id}.escaped " + errorName(error));\n}\n`).join("") + "export {};\n";

export function programOf(random: Random, options: Options = {}): Program {
  const isAllowed = (part: string) => options.withFiled || !(part in filed);
  const drawn = (options.holes ?? holes).filter(hole => options.holes || isAllowed(hole));
  const hole = random.pick(drawn);
  const isLean = options.isLean ?? random.chance(0.35);
  const count = options.cases ?? (isLean ? random.between(1, 2) : random.between(1, 4));
  const start = isLean ? leanPrelude : prelude;
  const built: Built[] = [];
  for (let attempts = 0; built.length < count && attempts < count * 60; attempts++) {
    const one = caseOf(built.length + 1, random, hole, isAllowed);
    if (one) built.push(one);
  }
  if (!built.length) throw new Error(`no type fits the hole ${hole}`);
  return {
    hole,
    text: start + built.map(one => one.text).join("") + runs(built.map((_, index) => index + 1)),
    parts: built.map(one => [...one.parts, ...(isLean ? ["lean"] : [])]),
    alone: built.map((one, index) => start + one.text + runs([index + 1])),
  };
}

/** One program with a case for each of the holes. */
export function programOfHoles(random: Random, wanted: string[], options: Options = {}): Program {
  const isAllowed = (part: string) => options.withFiled || !(part in filed);
  const start = options.isLean ? leanPrelude : prelude;
  const built = wanted.map((hole, index) => {
    for (let attempts = 0; attempts < 60; attempts++) {
      const one = caseOf(index + 1, random, hole, isAllowed);
      if (one) return one;
    }
    throw new Error(`no type fits the hole ${hole}`);
  });
  return {
    hole: wanted.join(" "),
    text: start + built.map(one => one.text).join("") + runs(built.map((_, index) => index + 1)),
    parts: built.map(one => one.parts),
    alone: built.map((one, index) => start + one.text + runs([index + 1])),
  };
}

if (import.meta.main) {
  const option = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (process.argv.includes("--list")) console.log(holes.map(hole => (hole in filed ? `${hole}\tfiled: ${filed[hole]}` : hole)).join("\n"));
  else {
    const folder = process.argv[2];
    const [count, first] = [Number(option("count") ?? 100), Number(option("seed") ?? 1)];
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "tsconfig.json"), tsconfig);
    const perHole: Record<string, number> = {};
    for (let seed = first; seed < first + count; seed++) {
      const program = programOf(new Random(seed), { withFiled: process.argv.includes("--with-filed"), holes: option("holes")?.split(","), cases: option("cases") ? Number(option("cases")) : undefined });
      perHole[program.hole] = (perHole[program.hole] ?? 0) + 1;
      writeFileSync(join(folder, `${seed}-${program.hole}.ts`), program.text);
    }
    console.log(Object.entries(perHole).sort().map(([hole, programs]) => `${programs}\t${hole}`).join("\n")); // prettier-ignore
  }
}
