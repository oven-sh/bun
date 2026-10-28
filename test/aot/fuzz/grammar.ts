// Generates small deterministic programs for the fuzzer: `generate(random, typed)` returns the text of one ES module, JavaScript
// or type-correct TypeScript. A program prints what it computes through `print(text)`, which the driver defines, so that two ways
// of running it can be compared line by line.
//
// A program is regular code that is disturbed late:
//   features   declare things (classes, records, arrays, closures ..), use them, and leave variables in scope for what follows
//   statements ordinary code of the wanted kinds, built from whatever is in scope; this is where features meet
//   attacks    change something a whole-program analysis may have proven (the type of a field, a layout, a prototype, a callee, a
//              built-in), usually from inside a callback that a built-in calls, and then look at the victim again
//
// The generator is typed by construction: every variable in scope has a `Kind`, and `expression(kind)` only builds what has that
// kind. TypeScript differs from JavaScript by what `annotation`, `cast` and `typeArguments` print. A value never enters a location whose
// written type it does not fit: a location that an attack stores another kind into has the kind `mixed` (`any`) from the start.
//
// To add a feature or an attack, write a function that takes the `Generator`, emits code with `emit` and declares what it leaves
// behind with `declare`, then list it in `features` or `attacks`. The first line of a program names what was drawn.
import { Random } from "./random";

export type Profile = {
  /** False for a program that uses no built-in that engines write in JavaScript and nothing of a host. Default: true. */
  library?: boolean;
  /** The features and attacks to run, in order, instead of a random draw: for looking at one of them alone. */
  steps?: readonly string[];
};

export function generate(random: Random, typed: boolean, profile: Profile = {}): string {
  return new Generator(random, typed, profile).program();
}

/** Lines of code; a nested array is indented one level deeper. */
type Code = string | Code[];

type Kind =
  | { is: "int32" | "number" | "string" | "boolean" | "bigint" | "symbol" }
  /** Holds `habit` in regular code; an attack may store any primitive or object. */
  | { is: "mixed"; habit: Kind }
  | { is: "array"; element: Kind }
  | { is: "instance"; of: ClassModel }
  | { is: "record"; shape: Shape }
  | { is: "function"; parameters: Kind[]; result: Kind }
  | { is: "map"; key: Kind; value: Kind }
  | { is: "set"; element: Kind };

type Field = { name: string; kind: Kind };
type Method = { name: string; parameters: Kind[]; result: Kind };
type Shape = { name: string; fields: Field[] };
/** A class, or a constructor function with methods on its prototype, whose instances have the static type `type`. */
type ClassModel = { name: string; type: string; isFunction: boolean; parent?: ClassModel; fields: Field[]; methods: Method[]; parameters: Kind[] };
type Variable = { name: string; kind: Kind; mutable: boolean };
type Place = { text: string; kind: Kind };
type Context = { top: boolean; loops: number; depth: number };
/** `alone`: it needs nothing in scope and brings its own disturbance. */
type Step = { name: string; weight: number; run(generator: Generator): boolean | void; alone?: boolean };

const int32: Kind = { is: "int32" };
const number: Kind = { is: "number" };
const string: Kind = { is: "string" };
const boolean: Kind = { is: "boolean" };
const bigint: Kind = { is: "bigint" };
const arrayOf = (element: Kind): Kind => ({ is: "array", element });
const mixedOf = (habit: Kind): Kind => ({ is: "mixed", habit });

const int32Literals = ["0", "1", "2", "3", "5", "7", "10", "31", "32", "100", "255", "65535", "(-1)", "(-7)", "1073741823", "2147483647", "(-2147483648)"];
const doubleLiterals = ["0.5", "1.5", "(-0)", "NaN", "Infinity", "(-Infinity)", "2147483648", "4294967296", "9007199254740991", "1e21", "0.1", "1e-7", "(-2.5)"];
const stringLiterals = ['""', '"a"', '"abc"', '"10"', '"-0"', '"1.5"', '"x,y"', '"Hello"', '"\\u{1F600}"', '"\\u00e9t\\u00e9"', '"length"', '" pad "', '"0x1f"', '"__proto__x"'];
const bigintLiterals = ["0n", "1n", "(-1n)", "7n", "4294967296n", "9007199254740993n", "(-9223372036854775808n)"];
const fieldNames = ["x", "y", "size", "name", "label", "flag", "tag", "items", "count", "weight", "id", "note"];
const methodNames = ["area", "step", "describe", "total", "scale", "render"];

/** Values of another kind for a place that held int32 values or strings so far. */
const otherValues = ['"text"', "0.5", "NaN", "(-0)", "undefined", "null", "true", "2147483648", "{ valueOf() { return 42; } }", "[7]", '""'];
const outOfRange = ["0.5", "NaN", "(-0)", "2147483648", "(-2147483649)", "Infinity", "4294967295", "1e21"];

/** What a program without the library may not contain. */
const needsLibrary = new RegExp(
  [
    String.raw`\.(map|filter|reduce|reduceRight|some|every|find|findIndex|findLast|findLastIndex|flatMap|forEach|next|return|throw|call|toSorted|from|fromEntries|entries|groupBy|then|catch|finally|take|drop|toArray|sort)\(`,
    String.raw`\.(copyWithin|lastIndexOf|toReversed|toSpliced|with|of|all|allSettled|race|any)\(|\.(keys|values)\(\)`,
    String.raw`\bReflect\.(get|has|apply|deleteProperty|set|setPrototypeOf)\b|\bnew Promise\b|\[\.\.\.|\bextends (Promise|Array|Map|Set)\b`,
    String.raw`\bfor await\b|\basync function\*|\.\.\.(arguments|new |")|\b(self|Intl)\b`,
  ].join("|"),
);

/** Draws from the caller's generator. Among pieces of code it leaves out those the profile does not allow. */
class Choices {
  readonly #source: Random;
  readonly #banned?: RegExp;

  constructor(source: Random, banned?: RegExp) {
    this.#source = source;
    this.#banned = banned;
  }

  allows(item: unknown): boolean {
    if (!this.#banned) return true;
    if (typeof item === "string") return !this.#banned.test(item);
    return !Array.isArray(item) || item.every(part => this.allows(part));
  }

  #allowed<T>(items: readonly T[]): readonly T[] {
    if (!this.#banned) return items;
    const allowed = items.filter(item => this.allows(item));
    return allowed.length > 0 ? allowed : items;
  }

  below(limit: number): number {
    return this.#source.below(limit);
  }

  between(low: number, high: number): number {
    return this.#source.between(low, high);
  }

  chance(probability: number): boolean {
    return this.#source.chance(probability);
  }

  pick<T>(items: readonly T[]): T {
    return this.#source.pick(this.#allowed(items));
  }

  weighted<T>(items: readonly (readonly [number, T])[]): T {
    return this.#source.weighted(this.#allowed(items));
  }

  shuffled<T>(items: readonly T[]): T[] {
    return this.#source.shuffled(this.#allowed(items));
  }

  sample<T>(items: readonly T[], count: number): T[] {
    return this.#source.sample(this.#allowed(items), count);
  }
}

function fieldsOf(kind: Kind): Field[] {
  if (kind.is === "record") return kind.shape.fields;
  if (kind.is !== "instance") return [];
  const fields: Field[] = [];
  for (let model: ClassModel | undefined = kind.of; model; model = model.parent) fields.unshift(...model.fields);
  return fields;
}

function methodsOf(model: ClassModel): Method[] {
  const methods = new Map<string, Method>();
  for (let current: ClassModel | undefined = model; current; current = current.parent) {
    for (const method of current.methods) if (!methods.has(method.name)) methods.set(method.name, method);
  }
  return [...methods.values()];
}

function same(a: Kind, b: Kind): boolean {
  if (a.is !== b.is) return false;
  if (a.is === "mixed" && b.is === "mixed") return true;
  if (a.is === "array" && b.is === "array") return same(a.element, b.element);
  if (a.is === "instance" && b.is === "instance") return a.of === b.of;
  if (a.is === "record" && b.is === "record") return a.shape === b.shape;
  if (a.is === "map" && b.is === "map") return same(a.key, b.key) && same(a.value, b.value);
  if (a.is === "set" && b.is === "set") return same(a.element, b.element);
  if (a.is === "function" && b.is === "function") {
    return a.parameters.length === b.parameters.length && a.parameters.every((kind, i) => same(kind, b.parameters[i])) && same(a.result, b.result);
  }
  return true;
}

/** Whether a value of kind `have` may stand where `want` is read. */
function fits(have: Kind, want: Kind): boolean {
  if (want.is === "number") return have.is === "int32" || have.is === "number";
  if (want.is === "mixed") return ["int32", "number", "string", "boolean", "mixed"].includes(have.is);
  if (want.is === "instance" && have.is === "instance") {
    for (let model: ClassModel | undefined = have.of; model; model = model.parent) if (model === want.of) return true;
    return false;
  }
  return same(have, want);
}

/** Splits `a + " " + b + " " + c` where the separators are not nested in brackets or quotes. */
function partsOf(expression: string): string[] {
  const separator = ` + " " + `;
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < expression.length; i++) {
    const character = expression[i];
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
    } else if (depth === 0 && expression.startsWith(separator, i)) {
      parts.push(expression.slice(start, i));
      i += separator.length - 1;
      start = i + 1;
    } else if (character === '"' || character === "`") quote = character;
    else if ("([{".includes(character)) depth++;
    else if (")]}".includes(character)) depth--;
  }
  return [...parts, expression.slice(start)];
}

function render(code: Code[], indent: string, lines: string[]): string[] {
  for (const item of code) {
    if (typeof item === "string") lines.push(indent + item);
    else render(item, indent + "  ", lines);
  }
  return lines;
}

class Generator {
  readonly random: Choices;
  readonly typed: boolean;
  readonly profile: Profile;
  readonly library: boolean;
  readonly classes: ClassModel[] = [];
  readonly shapes: Shape[] = [];
  readonly drawn: string[] = [];
  /** Functions that take any object with certain fields. */
  readonly readers: { name: string; fields: Field[] }[] = [];
  /** One kind per field name for the whole program, so that a function that reads `x` can take any object that has an `x`. */
  readonly fieldKinds = new Map<string, Kind>();
  #scopes: Variable[][] = [[]];
  #body: Code[] = [];
  #helpers = new Set<string>();
  #names = 0;
  #typeLines = 0;
  /** Off while a body is built that must not call back into the program. */
  #calls = true;
  /** In half of the programs no object is handed to a helper that takes everything, because such an object escapes and little is proven about it. */
  readonly direct: boolean;
  /** How long the program may get before its closing lines. A short program has less in it that spoils a proof. */
  sizeLimit: number;

  constructor(source: Random, typed: boolean, profile: Profile) {
    this.library = profile.library ?? true;
    const random = (this.random = new Choices(source, this.library ? undefined : needsLibrary));
    this.typed = typed;
    this.profile = profile;
    this.direct = random.chance(0.5);
    this.sizeLimit = profile.steps ? 150 : random.pick([30, 45, 60, 75, 84]);
    const kinds: [number, Kind][] = [[4, int32], [2, number], [3, string], [1, boolean], [3, mixedOf(int32)], [1, mixedOf(string)], [2, arrayOf(int32)], [1, bigint]];
    for (const name of fieldNames) this.fieldKinds.set(name, random.weighted(kinds));
  }

  program(): string {
    const { steps } = this.profile;
    if (steps) {
      for (const name of steps) this.attemptStep([...features, ...attacks, ...lastAttacks].find(step => step.name === name)!);
    } else {
      this.drawSteps();
      this.sizeLimit = 84;
      for (let tries = 0; tries < 5 && this.size() < 26; tries++) this.draw(scenes);
    }
    for (const variable of this.random.sample(this.visible(), 3)) this.emit(...this.lookCarefully(variable));
    if (this.#helpers.has("log")) this.emit(`flush("log");`);
    if (this.#helpers.has("mix")) this.emit(`print("checksum " + checksum);`);
    const lines = [`// ${this.typed ? "typed" : "untyped"}: ${this.drawn.join(", ")}`];
    return render([...this.helpers(), ...this.#body], "", lines).join("\n") + "\n";
  }

  drawSteps(): void {
    const { random } = this;
    const top: Context = { top: true, loops: 0, depth: 2 };
    const regular = (share: number) => this.attemptStep({ name: "", weight: 1, run: () => this.emit(...this.statements(random.between(1, 2), top)) }, share);
    if (random.chance(0.35)) {
      // A few features that bring their own disturbance, and little else.
      this.sizeLimit = Math.max(this.sizeLimit, 60);
      for (let i = random.between(1, 3); i > 0; i--) this.draw(scenes);
      if (random.chance(0.5)) regular(1);
      return;
    }
    // Objects first, so that what follows has something to work on. Room is kept for the attacks.
    for (let i = random.between(1, 2); i > 0; i--) this.draw(foundations, 0.6);
    const named = (name: string) => features.find(feature => feature.name === name)!;
    if (random.chance(0.6)) this.attemptStep(named("readers"), 0.6);
    if (random.chance(0.4)) this.attemptStep(named("functions"), 0.7);
    for (let i = random.between(0, 3); i > 0; i--) {
      this.draw(features, 0.7);
      if (random.chance(0.5)) regular(0.7);
      if (random.chance(0.5)) this.draw(attacks, 0.9);
    }
    for (let i = random.between(1, 2); i > 0; i--) this.draw(attacks);
    regular(1);
    if (random.chance(0.3)) this.draw(lastAttacks);
  }

  helpers(): Code[] {
    return Object.entries(this.helperTexts()).flatMap(([name, text]) => (this.#helpers.has(name) ? text : []));
  }

  /** Runs a step, and takes it back if it found nothing to work on or made the program too long. */
  attemptStep(step: Step, share = 1): boolean {
    const before = {
      body: this.#body.length,
      scopes: this.#scopes.map(scope => [...scope]),
      helpers: new Set(this.#helpers),
      typeLines: this.#typeLines,
      lengths: [this.classes, this.shapes, this.readers].map(list => list.length),
    };
    if (step.run(this) !== false && this.size() <= this.sizeLimit * share && this.random.allows(this.#body.slice(before.body))) {
      if (step.name) this.drawn.push(step.name);
      return true;
    }
    this.#body.length = before.body;
    this.#scopes = before.scopes;
    this.#helpers = before.helpers;
    this.#typeLines = before.typeLines;
    [this.classes, this.shapes, this.readers].forEach((list, i) => (list.length = before.lengths[i]));
    return false;
  }

  /** Emits up to `count` of the pieces, in random order. A piece that finds nothing to work on or is not allowed is passed over. */
  emitSome(pieces: (() => Code[] | undefined)[], count: number): void {
    for (const piece of this.random.shuffled(pieces)) {
      if (count <= 0) return;
      const run = () => {
        const code = piece();
        if (code) this.emit(...code);
        return code !== undefined;
      };
      if (this.attemptStep({ name: "", weight: 1, run }, Infinity)) count--;
    }
  }

  /** `share` is the part of the size limit that the program may fill with this step. */
  draw(from: Step[], share = 1): void {
    for (let tries = 0; tries < 8; tries++) {
      if (this.attemptStep(this.random.weighted(from.map(step => [step.weight, step] as const)), share)) return;
    }
  }

  /** The lines of the program without its helpers. */
  size(): number {
    return render(this.#body, "", []).length - this.#typeLines;
  }

  // What differs between TypeScript and JavaScript.

  annotation(kind: Kind | string): string {
    return this.typed ? ": " + (typeof kind === "string" ? kind : this.typeText(kind)) : "";
  }

  cast(expression: string, type = "any"): string {
    return this.typed ? `(${expression} as ${type})` : expression;
  }

  typeArguments(text: string): string {
    return this.typed ? `<${text}>` : "";
  }

  typeText(kind: Kind): string {
    switch (kind.is) {
      case "int32":
        return "number";
      case "mixed":
        return "any";
      case "array": {
        const element = this.typeText(kind.element);
        return /[ |=]/.test(element) ? `(${element})[]` : element + "[]";
      }
      case "instance":
        return kind.of.type;
      case "record":
        return kind.shape.name;
      case "function":
        return `(${kind.parameters.map((parameter, i) => `p${i}: ${this.typeText(parameter)}`).join(", ")}) => ${this.typeText(kind.result)}`;
      case "map":
        return `Map<${this.typeText(kind.key)}, ${this.typeText(kind.value)}>`;
      case "set":
        return `Set<${this.typeText(kind.element)}>`;
      default:
        return kind.is;
    }
  }

  // Names, scopes and output.

  fresh(prefix: string): string {
    return prefix + ++this.#names;
  }

  emit(...code: Code[]): void {
    this.#body.push(...(this.library ? code : this.pruned(code)));
  }

  /** Leaves out the parts of printed lines that the profile does not allow: `print("label " + a + " " + b);` loses `b`. */
  pruned(code: Code[]): Code[] {
    return code.map(item => {
      if (typeof item !== "string") return this.pruned(item);
      const line = /^(print\(|attempt\(\(\) => )(".*?") \+ (.*)\);$/.exec(item);
      if (!line || this.random.allows(item)) return item;
      const parts = partsOf(line[3]).filter(part => this.random.allows(part));
      return `${line[1]}${[line[2], ...(parts.length > 0 ? [parts.join(` + " " + `)] : [])].join(" + ")});`;
    });
  }

  /** A string expression that lists the enumerable keys of an object in order. */
  keysOf(expression: string): string {
    if (!this.direct || this.random.chance(0.2)) return `Object.keys(${expression}).join()`;
    return `(() => { let keys = ""; for (const key in ${expression}) keys += key + ","; return keys; })()`;
  }

  /** A string expression that lists `text` for every `item` of an array or another iterable. */
  listing(iterable: string, item = "item", text = `String(${item})`, isArray = true): string {
    if (this.library && this.random.chance(0.6)) return `${isArray ? iterable : `[...${iterable}]`}.map(${item.startsWith("[") ? `(${item})` : item} => ${text}).join()`;
    return `(() => { let listed = ""; for (const ${item} of ${iterable}) listed += ${text} + ","; return listed; })()`;
  }

  /** Code that is written differently in the two languages. It counts as the JavaScript form, so that both forms of a seed make the same choices. */
  emitEither(typeScript: Code[], javaScript: Code[]): void {
    if (this.typed) this.#typeLines += render(typeScript, "", []).length - render(javaScript, "", []).length;
    this.emit(...(this.typed ? typeScript : javaScript));
  }

  /** A line that only TypeScript has. It does not count as size, so that both forms of a seed make the same choices. */
  emitType(line: string): void {
    if (!this.typed) return;
    this.#typeLines++;
    this.emit(line);
  }

  withoutCalls<T>(build: () => T): T {
    const before = this.#calls;
    this.#calls = false;
    try {
      return build();
    } finally {
      this.#calls = before;
    }
  }

  need(helper: string): void {
    this.#helpers.add(helper);
  }

  declare(name: string, kind: Kind, mutable = false): Variable {
    const variable = { name, kind, mutable };
    this.#scopes[this.#scopes.length - 1].push(variable);
    return variable;
  }

  /** Takes a variable out of regular code, after an attack that would make ordinary uses of it throw. */
  retire(variable: Variable): void {
    for (const scope of this.#scopes) {
      const index = scope.indexOf(variable);
      if (index >= 0) scope.splice(index, 1);
    }
  }

  visible(): Variable[] {
    return this.#scopes.flat();
  }

  scoped<T>(variables: Variable[], build: () => T): T {
    this.#scopes.push([...variables]);
    try {
      return build();
    } finally {
      this.#scopes.pop();
    }
  }

  choose<T>(options: (readonly [number, () => T | undefined])[]): T {
    for (let tries = 0; ; tries++) {
      const result = this.random.weighted(options)();
      if (result !== undefined && (tries > 60 || this.random.allows(result))) return result;
    }
  }

  helperTexts(): Record<string, Code[]> {
    const a = (type: string) => this.annotation(type);
    return {
      mix: [`let checksum = 0;`, `function mix(value${a("number")})${a("void")} {`, [`checksum = (Math.imul(checksum, 31) + value) | 0;`], `}`],
      log: [
        `const log${a("string[]")} = [];`,
        `function flush(label${a("string")})${a("void")} {`,
        [`print(label + " " + log.length + " " + log.slice(-30).join(" "));`, `log.length = 0;`],
        `}`,
      ],
      errorName: [
        `function errorName(error${a("unknown")})${a("string")} {`,
        [
          `if (!(error instanceof Error)) return "thrown " + String(error);`,
          // The two refusals that only a compiled program knows are told apart from other errors: accepted-differences.tsv goes by these words.
          `if (error.message.includes("checks types at run time")) return error.constructor.name + " of a type check";`,
          `if (error.message.includes("compiled executable")) return error.constructor.name + " of a locked built-in";`,
          `return error.constructor.name + (error.message.startsWith("own ") ? "(" + error.message + ")" : "");`,
        ],
        `}`,
      ],
      attempt: [
        `function attempt(compute${a("() => string")})${a("void")} {`,
        [`try {`, [`print(compute());`], `} catch (error) {`, [`print("threw " + errorName(error));`], `}`],
        `}`,
      ],
      show: [
        `function show(value${a("unknown")}, depth${a("number")} = 0)${a("string")} {`,
        [
          `if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);`,
          `if (typeof value === "string") return JSON.stringify(value);`,
          `if (typeof value === "bigint") return value + "n";`,
          `if (typeof value === "symbol") return "Symbol(" + String(value.description) + ")";`,
          `if (typeof value === "function") return "function";`,
          `if (typeof value !== "object" || value === null) return String(value);`,
          `if (depth > 2) return "...";`,
          `const parts${a("string[]")} = [];`,
          `if (Array.isArray(value)) {`,
          [`for (let i = 0; i < value.length && i < 16; i++) parts.push(i in value ? show(value[i], depth + 1) : "hole");`, `return value.length + "[" + parts.join(", ") + "]";`],
          `}`,
          `if (value instanceof Map) {`,
          [`for (const [key, item] of value) parts.push(show(key, depth + 1) + " => " + show(item, depth + 1));`, `return "Map(" + parts.join(", ") + ")";`],
          `}`,
          `if (value instanceof Set) {`,
          [`for (const item of value) parts.push(show(item, depth + 1));`, `return "Set(" + parts.join(", ") + ")";`],
          `}`,
          `for (const key of Reflect.ownKeys(value)) {`,
          [`parts.push((typeof key === "symbol" ? "[" + String(key.description) + "]" : key) + ": " + show(${this.cast("value")}[key], depth + 1));`],
          `}`,
          `return "{" + parts.join(", ") + "}";`,
        ],
        `}`,
      ],
    };
  }

  show(expression: string): string {
    if (this.direct) return `String(${expression})`;
    this.need("show");
    return `show(${expression})`;
  }

  /** Text that tells the value of an expression, as a string expression. Primitives are mostly printed without a helper. */
  textOf(expression: string, kind: Kind): string {
    const { random } = this;
    switch (kind.is) {
      case "int32":
      case "boolean":
        return expression;
      case "number":
        return random.chance(0.5) ? expression : random.chance(0.5) && !this.direct ? this.show(expression) : `${expression} + "/" + 1 / ${expression}`;
      case "string":
        return random.chance(0.6) ? expression : `${expression}.length + ":" + ${expression}`;
      case "bigint":
        return `${expression} + "n"`;
      case "mixed":
        return random.chance(0.5) && !this.direct ? this.show(expression) : `typeof ${expression} + ":" + String(${expression})`;
      case "function":
        return `typeof ${expression}`;
      case "symbol":
        return `String(${expression}.description)`;
    }
    // The text of a function is not compared.
    if (kind.is === "array" && kind.element.is === "function") return `${expression}.length + ":" + ${this.listing(expression, "item", "typeof item")}`;
    if (!this.direct) return this.show(expression);
    switch (kind.is) {
      case "array":
        return `${expression}.length + "[" + ${this.listing(expression)} + "]"`;
      case "map":
        return this.listing(expression, "item", `item[0] + "=" + item[1]`, false);
      case "set":
        return this.listing(expression, "item", "String(item)", false);
      default:
        return fieldsOf(kind).length > 0 ? fieldsOf(kind).map(field => `String(${expression}.${field.name})`).join(` + "," + `) : `typeof ${expression}`;
    }
  }

  /** Reports a value: a printed line at the top level, an entry of the log or of the checksum inside loops and functions. */
  report(expression: string, kind: Kind, context: Context): Code {
    if (context.top && context.loops === 0) return `print("${this.fresh("at")} " + ${this.textOf(expression, kind)});`;
    if ((kind.is === "int32" || kind.is === "number") && this.random.chance(0.6)) {
      this.need("mix");
      return `mix(${expression});`;
    }
    this.need("log");
    return `log.push("" + ${this.textOf(expression, kind)});`;
  }

  guarded(code: Code[]): Code[] {
    this.need("errorName");
    return [`try {`, code, `} catch (error) {`, [`print("${this.fresh("caught")} " + errorName(error));`], `}`];
  }

  /** String expressions that tell what can be seen of a variable, reading its parts directly. Each starts with a label. */
  sights(variable: Variable): string[] {
    const { name, kind } = variable;
    const { random } = this;
    const label = this.fresh("see");
    const fields = fieldsOf(kind);
    if (fields.length > 0) {
      const sights = [`"${label} " + ${fields.map(field => this.textOf(`${name}.${field.name}`, field.kind)).join(` + " " + `)}`];
      if (random.chance(0.6)) {
        const keys = this.direct ? this.keysOf(name) : random.pick([this.keysOf(name), `JSON.stringify(${name}, (key, value) => (typeof value === "bigint" ? "big" : value))`, this.show(name)]);
        sights.push(`"${label} keys " + ${keys}`);
      }
      if (kind.is === "instance") {
        for (const method of random.sample(methodsOf(kind.of), 2)) {
          sights.push(`"${label} ${method.name} " + ${this.textOf(`${name}.${method.name}(${this.argumentsFor(method.parameters, 0)})`, method.result)}`);
        }
      }
      return sights;
    }
    if (kind.is === "array") return [`"${label} " + ${random.chance(0.5) || kind.element.is === "function" ? this.textOf(name, kind) : `${name}.length + " " + ${name}.join()`}`];
    if (kind.is === "function") return [`"${label} " + ${this.textOf(`${name}(${this.argumentsFor(kind.parameters, 0)})`, kind.result)}`];
    if (kind.is === "symbol") return [`"${label} " + String(${name}.description)`];
    return [`"${label} " + ${this.textOf(name, kind)}`];
  }

  look(variable: Variable): Code[] {
    return this.sights(variable).map(sight => `print(${sight});`);
  }

  /** Prints string expressions that may throw. */
  attempt(sights: string[]): Code[] {
    if (this.random.chance(0.3)) return this.guarded(sights.map(sight => `print(${sight});`));
    this.need("errorName");
    this.need("attempt");
    return sights.map(sight => `attempt(() => ${sight});`);
  }

  lookCarefully(variable: Variable): Code[] {
    return this.attempt(this.sights(variable));
  }

  // Places: what can be read or written without computing anything.

  places(want: Kind): string[] {
    const found: string[] = [];
    for (const variable of this.visible()) {
      if (fits(variable.kind, want)) found.push(variable.name);
      for (const field of fieldsOf(variable.kind)) if (fits(field.kind, want)) found.push(`${variable.name}.${field.name}`);
    }
    return found;
  }

  place(want: Kind): string | undefined {
    const found = this.places(want);
    return found.length > 0 ? this.random.pick(found) : undefined;
  }

  /** Builds an expression around a place of the kind `mixed`, whose static type allows every operator. */
  withMixed(build: (place: string) => string): string | undefined {
    const found: string[] = [];
    for (const variable of this.visible()) {
      if (variable.kind.is === "mixed") found.push(variable.name);
      for (const field of fieldsOf(variable.kind)) if (field.kind.is === "mixed") found.push(`${variable.name}.${field.name}`);
    }
    return found.length > 0 ? build(this.random.pick(found)) : undefined;
  }

  writablePlaces(accept: (kind: Kind) => boolean): Place[] {
    const found: Place[] = [];
    for (const variable of this.visible()) {
      if (variable.mutable && accept(variable.kind)) found.push({ text: variable.name, kind: variable.kind });
      for (const field of fieldsOf(variable.kind)) if (accept(field.kind)) found.push({ text: `${variable.name}.${field.name}`, kind: field.kind });
    }
    return found;
  }

  variables(accept: (kind: Kind) => boolean): Variable[] {
    return this.visible().filter(variable => accept(variable.kind));
  }

  variable(accept: (kind: Kind) => boolean): Variable | undefined {
    const found = this.variables(accept);
    return found.length > 0 ? this.random.pick(found) : undefined;
  }

  // Expressions.

  expression(kind: Kind, depth = 2): string {
    switch (kind.is) {
      case "int32":
        return this.int32(depth);
      case "number":
        return this.number(depth);
      case "string":
        return this.string(depth);
      case "boolean":
        return this.boolean(depth);
      case "bigint":
        return this.bigint(depth);
      case "symbol":
        return this.place(kind) ?? `Symbol.for(${this.random.pick(stringLiterals)})`;
      case "mixed":
        return this.random.chance(0.3) ? (this.place(kind) ?? this.expression(kind.habit, depth)) : this.expression(kind.habit, depth);
      case "array":
        return this.array(kind.element, depth);
      case "instance":
        return this.instance(kind.of, depth);
      case "record":
        return this.record(kind.shape, depth);
      case "function":
        return this.closure(kind, depth);
      case "map":
        return this.place(kind) ?? `new Map${this.typeArguments(`${this.typeText(kind.key)}, ${this.typeText(kind.value)}`)}([[${this.expression(kind.key, 0)}, ${this.expression(kind.value, 0)}]])`;
      case "set":
        return this.place(kind) ?? `new Set${this.typeArguments(this.typeText(kind.element))}([${this.expression(kind.element, 0)}, ${this.expression(kind.element, 0)}])`;
    }
  }

  argumentsFor(parameters: Kind[], depth: number): string {
    return parameters.map(parameter => this.expression(parameter, depth)).join(", ");
  }

  /** A call of a function or a method in scope whose result has the wanted kind. */
  call(want: Kind, depth: number): string | undefined {
    if (!this.#calls) return undefined;
    const calls: (() => string)[] = [];
    for (const variable of this.visible()) {
      const { kind, name } = variable;
      if (kind.is === "function" && fits(kind.result, want)) calls.push(() => this.callFunction(name, this.argumentsFor(kind.parameters, depth - 1)));
      if (kind.is === "instance") {
        for (const method of methodsOf(kind.of)) {
          if (fits(method.result, want)) calls.push(() => this.callMethod(name, method.name, this.argumentsFor(method.parameters, depth - 1)));
        }
      }
    }
    return calls.length > 0 ? this.random.pick(calls)() : undefined;
  }

  callFunction(name: string, list: string): string {
    const rest = list ? ", " + list : "";
    return this.random.weighted<string>([
      [12, `${name}(${list})`],
      [1, `${name}.call(undefined${rest})`],
      [1, `${name}.apply(undefined, [${list}])`],
      [1, `Reflect.apply(${name}, undefined, [${list}])`],
      [1, `${name}.bind(undefined${rest})()`],
      [1, `[${name}][0](${list})`],
      [1, `{ run: ${name} }.run(${list})`.replace(/^(.*)\.run\(/, "($1).run(")],
    ]);
  }

  callMethod(receiver: string, method: string, list: string): string {
    const rest = list ? ", " + list : "";
    return this.random.weighted<string>([
      [12, `${receiver}.${method}(${list})`],
      [1, `${receiver}["${method}"](${list})`],
      [2, `${this.cast(receiver)}[${this.computedKey(method)}](${list})`],
      [1, `${receiver}.${method}.call(${receiver}${rest})`],
      [1, `${receiver}.${method}.apply(${receiver}, [${list}])`],
      [1, `Reflect.apply(${receiver}.${method}, ${receiver}, [${list}])`],
      [1, `${receiver}.${method}.bind(${receiver})(${list})`],
    ]);
  }

  /** A literal of a primitive kind. */
  literal(kind: Kind): string {
    const { random } = this;
    switch (kind.is) {
      case "int32":
        return random.pick(int32Literals);
      case "number":
        return random.pick(doubleLiterals);
      case "string":
        return random.pick(stringLiterals);
      case "boolean":
        return random.pick(["true", "false"]);
      case "bigint":
        return random.pick(bigintLiterals);
      case "mixed":
        return this.literal(kind.habit);
      default:
        return this.withoutCalls(() => this.scoped([], () => this.expression(kind, 0)));
    }
  }

  /** An index that is mostly inside a small array and sometimes past its end or negative. */
  index(depth: number): string {
    return this.random.chance(0.7) ? String(this.random.below(4)) : this.random.chance(0.7) ? `(${this.int32(depth)} & 3)` : this.int32(depth);
  }

  /** An element of an array in scope. A kind whose values get methods called on them has a fallback for a missing element. */
  element(want: Kind, depth: number): string | undefined {
    const array = this.place(arrayOf(want));
    if (!array) return undefined;
    const read = this.random.chance(0.8) ? `${array}[${this.index(depth)}]` : `${array}.at(${this.random.pick(["-1", "0", "-2", "9"])})`;
    if (want.is === "int32") return read.includes(".at(") ? `((${read} ?? 0) | 0)` : `(${read} | 0)`;
    if (want.is === "number" && !read.includes(".at(")) return read;
    return `(${read} ?? ${this.expression(want, 0)})`;
  }

  int32(depth: number): string {
    const { random } = this;
    const literal = () => random.pick(int32Literals);
    if (depth <= 0) return (random.chance(0.7) && this.place(int32)) || literal();
    const operand = () => this.int32(depth - 1);
    return this.choose<string>([
      [4, () => this.place(int32)],
      [2, literal],
      [3, () => `((${operand()} ${random.pick(["+", "-", "*"])} ${operand()}) | 0)`],
      [1, () => `Math.imul(${operand()}, ${operand()})`],
      [2, () => `(${operand()} ${random.pick(["&", "|", "^"])} ${operand()})`],
      [1, () => `(${operand()} ${random.pick(["<<", ">>"])} ${random.chance(0.7) ? random.below(33) : operand()})`],
      [1, () => `(~${operand()})`],
      [1, () => `(${this.number(depth - 1)} | 0)`],
      [1, () => `(${this.boolean(depth - 1)} ? ${operand()} : ${operand()})`],
      [1, () => `${this.string(depth - 1)}.length`],
      [1, () => `(${this.string(depth - 1)}.charCodeAt(${this.index(0)}) | 0)`],
      [1, () => `${this.string(depth - 1)}.indexOf(${this.string(0)})`],
      [2, () => this.call(int32, depth)],
      [2, () => this.element(int32, depth - 1)],
      [1, () => this.lengthOfSomething()],
      [1, () => (this.place(arrayOf(string)) ? `${this.place(arrayOf(string))}.indexOf(${this.string(depth - 1)})` : undefined)],
      [1, () => (this.place(arrayOf(int32)) ? `(${this.boolean(depth - 1)} ? ${this.place(arrayOf(int32))} : Array.prototype).length` : undefined)],
      [1, () => this.withMixed(place => `(${place} | 0)`)],
      [1, () => `Math.${random.pick(["min", "max"])}(${operand()}, ${operand()})`],
      [1, () => `Math.clz32(${operand()})`],
    ]);
  }

  lengthOfSomething(): string | undefined {
    const variable = this.variable(kind => kind.is === "array" || kind.is === "map" || kind.is === "set");
    return variable && `${variable.name}.${variable.kind.is === "array" ? "length" : "size"}`;
  }

  number(depth: number): string {
    const { random } = this;
    const literal = () => (random.chance(0.6) ? random.pick(doubleLiterals) : random.pick(int32Literals));
    if (depth <= 0) return (random.chance(0.7) && this.place(number)) || literal();
    const operand = () => this.number(depth - 1);
    return this.choose<string>([
      [4, () => this.place(number)],
      [2, literal],
      [2, () => this.int32(depth)],
      [4, () => `(${operand()} ${random.pick(["+", "-", "*", "/", "%"])} ${operand()})`],
      [1, () => `(${operand()} ** ${random.pick(["2", "3", "0.5", "(-1)", "31", "0"])})`],
      [1, () => `(-${operand()})`],
      [1, () => `(${this.int32(depth - 1)} >>> ${random.pick(["0", "1", "31"])})`],
      [2, () => `Math.${random.pick(["floor", "ceil", "round", "trunc", "sign", "abs", "sqrt", "fround"])}(${operand()})`],
      [1, () => `Math.${random.pick(["min", "max"])}(${operand()}, ${operand()})`],
      [1, () => `${random.pick(["Number(", "parseFloat(", "(+"])}${this.string(depth - 1)})`],
      [1, () => `parseInt(${this.string(depth - 1)}, ${random.pick(["10", "16", "2"])})`],
      [1, () => `(${this.boolean(depth - 1)} ? ${operand()} : ${operand()})`],
      [2, () => this.call(number, depth)],
      [2, () => this.element(number, depth - 1)],
      [1, () => this.withMixed(place => `(${place} ${random.pick(["*", "-", "/"])} ${operand()})`)],
      [1, () => `Number(${this.bigint(depth - 1)})`],
    ]);
  }

  string(depth: number): string {
    const { random } = this;
    const literal = () => random.pick(stringLiterals);
    if (depth <= 0) return (random.chance(0.7) && this.place(string)) || literal();
    const operand = () => this.string(depth - 1);
    const small = () => (random.chance(0.7) ? String(random.below(5)) : `(${this.int32(depth - 1)} & 7)`);
    return this.choose<string>([
      [4, () => this.place(string)],
      [2, literal],
      [3, () => `(${operand()} + ${operand()})`],
      [2, () => `(${operand()} + ${this.number(depth - 1)})`],
      [2, () => "`" + `${random.pick(["", "<", "v="])}\${${this.expression(random.pick([int32, number, string, boolean]), depth - 1)}}${random.pick(["", ">", ";"])}` + "`"],
      [1, () => `String(${this.expression(random.pick([int32, number, boolean, bigint]), depth - 1)})`],
      [2, () => `${operand()}.slice(${random.pick(["0", "1", "-2", small()])}${random.chance(0.5) ? ", " + small() : ""})`],
      [1, () => `${operand()}.${random.pick(["toUpperCase", "toLowerCase", "trim"])}()`],
      [1, () => `${operand()}.${random.pick(["padStart", "padEnd"])}(${small()}, ${random.pick(['"*"', '"ab"', '""'])})`],
      [1, () => `${operand()}.repeat(${random.below(3)})`],
      [1, () => `${operand()}.charAt(${this.index(0)})`],
      [1, () => `(${operand()}[${this.index(0)}] ?? "none")`],
      [1, () => `(${operand()}.at(${random.pick(["-1", "0", "7"])}) ?? "none")`],
      [1, () => `${operand()}.substring(${small()}, ${small()})`],
      [1, () => `${operand()}.split(${random.pick(['""', '","', '"a"'])}).join(${random.pick(['"-"', '""', '"+"'])})`],
      [1, () => `${operand()}.replace(${random.pick(['"a"', "/[a-c]/g", "/\\d+/", '""'])}, ${random.pick(['"_"', '"$&$&"', `(match${this.annotation("string")}) => match.length + "!"`])})`],
      [1, () => `(${this.int32(depth - 1)} | 0).toString(${random.pick(["2", "10", "16", "36"])})`],
      [1, () => `(+${this.number(depth - 1)}).toFixed(${random.below(4)})`],
      [1, () => `String.fromCharCode(65 + (${this.int32(depth - 1)} & 15))`],
      [1, () => `(typeof ${this.expression(random.pick([int32, string, boolean, bigint, mixedOf(int32)]), depth - 1)})`],
      [1, () => (this.place(arrayOf(int32)) ? `${this.place(arrayOf(int32))}.join(${random.pick(['"-"', '""', ""])})` : undefined)],
      [1, () => `(${this.boolean(depth - 1)} ? ${operand()} : ${operand()})`],
      [2, () => this.call(string, depth)],
      [2, () => this.element(string, depth - 1)],
      [1, () => this.withMixed(place => `String(${place})`)],
    ]);
  }

  /** An operand for a comparison with a literal: the checker gives it no literal type and does not narrow it in the branches. */
  wide(kind: Kind, depth: number): string {
    const place = this.place(kind);
    if (place) return this.cast(place, this.typeText(kind));
    if (kind.is === "string") return `String(${this.string(depth)})`;
    return `Number(${this.expression(kind, depth)})`;
  }

  boolean(depth: number): string {
    const { random } = this;
    if (depth <= 0) return (random.chance(0.6) && this.place(boolean)) || random.pick(["true", "false"]);
    const operand = () => this.boolean(depth - 1);
    return this.choose<string>([
      [2, () => this.place(boolean)],
      [4, () => `(${this.number(depth - 1)} ${random.pick(["<", "<=", ">", ">="])} ${this.number(depth - 1)})`],
      [3, () => `(${this.wide(random.pick([int32, number]), depth - 1)} ${random.pick(["===", "!==", "==", "!="])} ${this.number(depth - 1).replace(/^NaN$/, "(0 / 0)")})`],
      [2, () => `(${this.wide(string, depth - 1)} ${random.pick(["===", "!==", "<", ">"])} ${this.string(depth - 1)})`],
      [1, () => `(!${operand()})`],
      [2, () => `(${operand()} ${random.pick(["&&", "||"])} ${operand()})`],
      [1, () => `Object.is(${this.number(depth - 1)}, ${this.number(depth - 1)})`],
      [1, () => `Number.${random.pick(["isInteger", "isNaN", "isFinite", "isSafeInteger"])}(${this.number(depth - 1)})`],
      [1, () => `${this.string(depth - 1)}.${random.pick(["startsWith", "endsWith", "includes"])}(${this.string(0)})`],
      [1, () => (this.place(arrayOf(int32)) ? `${this.place(arrayOf(int32))}.includes(${this.int32(depth - 1)})` : undefined)],
      [1, () => (this.place(arrayOf(number)) ? `${this.place(arrayOf(number))}.includes(${this.number(depth - 1)})` : undefined)],
      [1, () => (this.place(arrayOf(string)) ? `${this.place(arrayOf(string))}.includes(${this.string(depth - 1)})` : undefined)],
      [1, () => this.membership()],
      // The cast keeps the checker from narrowing the place in the branches.
      [1, () => this.withMixed(place => `(typeof ${this.cast(place)} === ${random.pick(['"number"', '"string"', '"undefined"', '"object"'])})`)],
      [1, () => this.withMixed(place => `(${place} ${random.pick(["==", "===", "<", ">="])} ${this.expression(random.pick([int32, string]), 0)})`)],
      [1, () => `(${this.bigint(depth - 1)} ${random.pick(["<", ">", "<="])} ${random.chance(0.5) ? this.bigint(depth - 1) : this.int32(depth - 1)})`],
      [1, () => `(${this.cast(this.bigint(depth - 1))} == ${random.chance(0.5) ? this.bigint(depth - 1) : this.int32(depth - 1)})`],
      [1, () => this.call(boolean, depth)],
    ]);
  }

  membership(): string | undefined {
    const { random } = this;
    const variable = this.variable(kind => kind.is === "instance" || kind.is === "record" || kind.is === "map" || kind.is === "set");
    if (!variable) return undefined;
    const { kind, name } = variable;
    if (kind.is === "map") return `${name}.has(${this.expression(kind.key, 1)})`;
    if (kind.is === "set") return `${name}.has(${this.expression(kind.element, 1)})`;
    if (kind.is === "instance" && random.chance(0.5)) return `(${this.cast(name, "object")} instanceof ${random.pick([...this.classes, kind.of]).name})`;
    const key = `"${random.pick(fieldNames)}"`;
    return random.chance(0.5) ? `(${key} in ${this.cast(name, "object")})` : `Object.hasOwn(${name}, ${key})`;
  }

  bigint(depth: number): string {
    const { random } = this;
    if (depth <= 0) return (random.chance(0.6) && this.place(bigint)) || random.pick(bigintLiterals);
    const operand = () => this.bigint(depth - 1);
    return this.choose<string>([
      [3, () => this.place(bigint)],
      [2, () => random.pick(bigintLiterals)],
      [3, () => `(${operand()} ${random.pick(["+", "-", "&", "|", "^"])} ${operand()})`],
      [2, () => `BigInt.asIntN(64, ${operand()} * ${operand()})`],
      [1, () => `(${operand()} ${random.pick(["/", "%"])} (${operand()} | 1n))`],
      [1, () => `BigInt(${this.int32(depth - 1)} | 0)`],
      [1, () => `BigInt.asUintN(${random.pick(["8", "32", "64"])}, ${operand()})`],
      [1, () => `(${operand()} ${random.pick(["<<", ">>"])} ${random.pick(["1n", "7n", "33n"])})`],
      [1, () => `(-${operand()})`],
      [1, () => this.call(bigint, depth)],
      [1, () => this.element(bigint, depth - 1)],
    ]);
  }

  /** `(name) => expression`, with the parameters in scope while the body is built. */
  arrow(parameters: [string, Kind][], result: Kind, depth: number, annotate = false): string {
    const variables = parameters.filter(([name]) => name !== "_").map(([name, kind]) => ({ name, kind, mutable: false }));
    const body = this.scoped(variables, () => this.expression(result, depth));
    const list = parameters.map(([name, kind]) => name + (annotate ? this.annotation(kind) : "")).join(", ");
    return `(${list}) => ${body.startsWith("{") ? `(${body})` : body}`;
  }

  array(element: Kind, depth: number): string {
    const { random } = this;
    const kind = arrayOf(element);
    const literal = () => {
      const items = Array.from({ length: random.below(5) }, () => this.expression(element, Math.min(depth, 1) - 1));
      return (items.length > 0 && element.is !== "mixed") || !this.typed ? `[${items.join(", ")}]` : `([${items.join(", ")}] as ${this.typeText(kind)})`;
    };
    if (depth <= 0) return (random.chance(0.6) && this.place(kind)) || literal();
    const operand = () => this.array(element, depth - 1);
    const item = this.fresh("e");
    return this.choose<string>([
      [3, () => this.place(kind)],
      [4, literal],
      [1, () => `${operand()}.slice(${random.pick(["", "1", "-2", "0, 2"])})`],
      [1, () => `${operand()}.concat(${operand()}).slice(0, 12)`],
      [1, () => `[...${operand()}, ${this.expression(element, depth - 1)}]`],
      [2, () => `${operand()}.map(${this.arrow([[item, element]], element, depth - 1)})`],
      [2, () => `${operand()}.filter(${this.arrow([[item, element]], boolean, depth - 1)})`],
      [1, () => `Array.from(${operand()})`],
      [1, () => `Array.from({ length: ${random.below(5)} }, ${this.arrow([["_", mixedOf(int32)], [item, int32]], element, depth - 1)})`],
      [1, () => `${operand()}.toReversed()`],
      [1, () => `new Array${this.typeArguments(this.typeText(element))}(${random.below(4)}).fill(${this.expression(element, depth - 1)})`],
      [1, () => this.call(kind, depth)],
    ]);
  }

  instance(model: ClassModel, depth: number): string {
    const place = this.place({ is: "instance", of: model });
    if (place && this.random.chance(depth <= 0 ? 0.9 : 0.6)) return place;
    const heirs = this.classes.filter(candidate => fits({ is: "instance", of: candidate }, { is: "instance", of: model }));
    if (heirs.length === 0) return place ?? this.cast("undefined");
    const chosen = this.random.pick(heirs);
    return this.construct(chosen, this.argumentsFor(chosen.parameters, Math.max(depth - 1, 0)));
  }

  construct(model: ClassModel, list: string): string {
    const { random } = this;
    const callee = model.isFunction ? this.cast(model.name) : model.name;
    return random.weighted<string>([
      [8, `new ${callee}(${list})`],
      [1, `Reflect.construct(${model.name}, [${list}])`],
      [1, `new ${callee}(...${this.cast(`[${list}]`, `[${model.parameters.map(parameter => this.typeText(parameter)).join(", ")}]`)})`],
    ]);
  }

  prototypeOf(model: ClassModel): string {
    return `${model.isFunction ? this.cast(model.name) : model.name}.prototype`;
  }

  record(shape: Shape, depth: number): string {
    const place = this.place({ is: "record", shape });
    if (place && this.random.chance(depth <= 0 ? 0.9 : 0.5)) return place;
    const fields = this.random.chance(0.8) ? shape.fields : this.random.shuffled(shape.fields);
    return `{ ${fields.map(field => `${field.name}: ${this.expression(field.kind, Math.max(depth - 1, 0))}`).join(", ")} }`;
  }

  closure(kind: Kind & { is: "function" }, depth: number): string {
    const place = this.place(kind);
    if (place && this.random.chance(0.5)) return place;
    return this.arrow(
      kind.parameters.map(parameter => [this.fresh("p"), parameter]),
      kind.result,
      Math.max(depth - 1, 1),
      true,
    );
  }

  /** A kind for a new variable, parameter or result. */
  someKind(simple = false): Kind {
    const { random } = this;
    const options: [number, Kind][] = [[5, int32], [3, number], [4, string], [2, boolean], [1, bigint], [2, mixedOf(int32)]];
    if (!simple) {
      options.push([2, arrayOf(int32)], [1, arrayOf(number)], [1, arrayOf(string)], [1, arrayOf(mixedOf(int32))]);
      for (const model of this.classes) options.push([2, { is: "instance", of: model }]);
      for (const shape of this.shapes) options.push([2, { is: "record", shape }]);
    }
    return random.weighted(options);
  }

  // Statements.

  statements(count: number, context: Context): Code[] {
    const code: Code[] = [];
    for (let i = 0; i < count; i++) code.push(...this.statement(context));
    return code;
  }

  block(count: number, context: Context, variables: Variable[] = []): Code[] {
    return this.scoped(variables, () => this.statements(count, { ...context, depth: context.depth - 1 }));
  }

  statement(context: Context): Code[] {
    const { random } = this;
    const nested = context.depth > 0;
    return this.choose<Code[]>([
      [4, () => this.declaration()],
      [5, () => this.assignment(context)],
      [4, () => this.output(context)],
      [2, () => this.arrayMutation()],
      [1, () => this.collectionMutation()],
      [nested ? 2 : 0, () => [`if (${this.boolean(2)}) {`, this.block(random.between(1, 2), context), ...(random.chance(0.5) ? [`} else {`, this.block(1, context)] : []), `}`]],
      [nested && context.loops < 2 ? 3 : 0, () => this.loop(context)],
      [nested ? 1 : 0, () => this.switchStatement(context)],
      [nested ? 1 : 0, () => this.tryStatement(context)],
    ]);
  }

  declaration(kind = this.someKind()): Code[] {
    const mutable = this.random.chance(0.6);
    const name = this.fresh("v");
    const value = this.expression(kind, 2);
    this.declare(name, kind, mutable);
    return [`${mutable ? "let" : "const"} ${name}${this.annotation(kind)} = ${value};`];
  }

  assignment(context: Context): Code[] | undefined {
    const { random } = this;
    const places = this.writablePlaces(kind => ["int32", "number", "string", "boolean", "bigint", "mixed", "array"].includes(kind.is));
    if (places.length === 0) return undefined;
    const { text, kind } = random.pick(places);
    switch (kind.is) {
      case "int32":
        // Now and then a place that held int32 values so far gets a value outside the range.
        if (random.chance(0.08)) return [`${text} = ${this.number(1)};`];
        return [
          random.weighted([
            [4, `${text} = ${this.int32(2)};`],
            [2, `${text} = (${text} ${random.pick(["+", "-", "*"])} ${this.int32(1)}) | 0;`],
            [1, `${text} ${random.pick(["&=", "|=", "^=", ">>=", "<<="])} ${this.int32(1)};`],
            [1, `${text}${random.pick(["++", "--"])};`],
          ]),
        ];
      case "number":
        return [random.chance(0.6) ? `${text} = ${this.number(2)};` : `${text} ${random.pick(["+=", "-=", "*=", "/=", "%=", "**="])} ${this.number(1)};`];
      case "string":
        return [random.chance(0.5) ? `${text} = ${this.string(2)}.slice(-24);` : context.loops > 0 ? `${text} = (${text} + ${this.string(1)}).slice(-24);` : `${text} += ${this.string(1)};`];
      case "boolean":
        return [random.chance(0.6) ? `${text} = ${this.boolean(2)};` : `${text} ${random.pick(["&&=", "||="])} ${this.boolean(1)};`];
      case "bigint":
        return [`${text} = BigInt.asIntN(64, ${this.bigint(2)});`];
      case "mixed":
        return [random.chance(0.8) ? `${text} = ${this.expression(kind.habit, 2)};` : `${text} ??= ${this.expression(kind.habit, 1)};`];
      default:
        return [`${text} = ${this.expression(kind, 2)}.slice(0, 12);`];
    }
  }

  output(context: Context): Code[] {
    const kind = this.someKind(this.random.chance(0.7));
    return [this.report(this.expression(kind, 2), kind, context)];
  }

  arrayMutation(): Code[] | undefined {
    const { random } = this;
    const variable = this.variable(kind => kind.is === "array");
    if (!variable || variable.kind.is !== "array") return undefined;
    const { name } = variable;
    const { element } = variable.kind;
    const value = () => this.expression(element, 1);
    const numeric = element.is === "int32" || element.is === "number";
    return [
      random.weighted<string>([
        [4, `${name}.push(${value()}${random.chance(0.2) ? ", " + value() : ""});`],
        [2, `${name}.pop();`],
        [1, `${name}.shift();`],
        [1, `${name}.unshift(${value()});`],
        [2, `${name}[${random.chance(0.8) ? random.below(4) : random.chance(0.8) ? `${this.int32(1)} & 7` : "-1"}] = ${value()};`],
        [1, `${name}[${name}.length] = ${value()};`],
        [1, `${name}.splice(${random.below(3)}, ${random.below(3)}${random.chance(0.5) ? ", " + value() : ""});`],
        [1, `${name}.reverse();`],
        [1, `${name}.fill(${value()}, ${random.below(3)});`],
        [1, `${name}.copyWithin(0, ${random.between(1, 2)});`],
        [1, `${name}.length = Math.min(${name}.length, ${random.below(4)});`],
        [numeric ? 2 : 0, `${name}.sort((a, b) => ${random.pick(["a - b", "b - a", "(a & 3) - (b & 3)"])});`],
        [element.is === "string" ? 2 : 0, `${name}.sort();`],
      ]),
    ];
  }

  collectionMutation(): Code[] | undefined {
    const { random } = this;
    const variable = this.variable(kind => kind.is === "map" || kind.is === "set");
    if (!variable) return undefined;
    const { name, kind } = variable;
    if (kind.is === "map") {
      return [random.chance(0.7) ? `${name}.set(${this.expression(kind.key, 1)}, ${this.expression(kind.value, 1)});` : `${name}.delete(${this.expression(kind.key, 1)});`];
    }
    if (kind.is === "set") return [random.chance(0.7) ? `${name}.add(${this.expression(kind.element, 1)});` : `${name}.delete(${this.expression(kind.element, 1)});`];
    return undefined;
  }

  loop(context: Context): Code[] {
    const { random } = this;
    const inner = { ...context, loops: context.loops + 1 };
    const count = context.loops === 0 && context.top ? random.pick([2, 3, 5, 8, 20, 60]) : random.between(1, 4);
    const index = this.fresh("i");
    const counter: Variable = { name: index, kind: int32, mutable: false };
    const array = this.variable(kind => kind.is === "array" && ["int32", "number", "string", "mixed"].includes(kind.element.is));
    return this.choose<Code[]>([
      [4, () => [`for (let ${index} = 0; ${index} < ${count}; ${index}++) {`, this.block(random.between(1, 3), inner, [counter]), `}`]],
      [1, () => [`for (let ${index} = ${count}; ${index} > 0; ${index} -= ${random.between(1, 2)}) {`, this.block(random.between(1, 2), inner, [counter]), `}`]],
      [
        2,
        () => {
          if (!array || array.kind.is !== "array") return undefined;
          const { element } = array.kind;
          const item = this.fresh("e");
          // A hole gives undefined, which numbers and `mixed` take without throwing.
          const raw = element.is === "string" ? this.fresh("raw") : item;
          const head: Code[] = element.is === "string" ? [`const ${item} = ${raw} ?? "hole";`] : [];
          const body = this.block(random.between(1, 2), inner, [{ name: item, kind: element.is === "int32" ? number : element, mutable: false }]);
          // The body may grow the array, so either a copy is iterated or the loop ends early.
          if (random.chance(0.5)) return [`for (const ${raw} of ${array.name}.slice(0, 8)) {`, [...head, ...body], `}`];
          return [`let ${index} = 0;`, `for (const ${raw} of ${array.name}) {`, [`if (++${index} > 8) break;`, ...head, ...body], `}`];
        },
      ],
      [1, () => [`let ${index} = 0;`, `while (${index} < ${count}) {`, [...this.block(random.between(1, 2), inner, [counter]), `${index}++;`], `}`]],
      [1, () => [`let ${index} = 0;`, `do {`, [...this.block(1, inner, [counter]), `${index} += ${random.between(1, 3)};`], `} while (${index} < ${count});`]],
      [
        1,
        () => {
          const other = this.fresh("j");
          const label = this.fresh("outer");
          this.need("mix");
          return [
            `${label}: for (let ${index} = 0; ${index} < ${random.between(2, 4)}; ${index}++) {`,
            [
              `for (let ${other} = 0; ${other} < ${random.between(2, 4)}; ${other}++) {`,
              this.scoped([counter, { name: other, kind: int32, mutable: false }], () => [
                `if (${this.boolean(1)}) continue ${label};`,
                `if (${this.boolean(1)}) break ${random.chance(0.5) ? label : ""};`.replace(" ;", ";"),
                `mix(${index} * 8 + ${other});`,
              ]),
              `}`,
            ],
            `}`,
          ];
        },
      ],
      [
        1,
        () => {
          const variable = this.variable(kind => kind.is === "record" || kind.is === "instance");
          if (!variable) return undefined;
          const key = this.fresh("k");
          this.need("log");
          return [`for (const ${key} in ${variable.name}) log.push(${key});`];
        },
      ],
    ]);
  }

  switchStatement(context: Context): Code[] {
    const { random } = this;
    const onString = random.chance(0.3);
    const subject = onString ? this.wide(string, 1) : `${this.int32(2)} & 3`;
    const labels = onString ? random.sample(stringLiterals, 3) : random.sample(["0", "1", "2", "3"], 3);
    const cases: Code[] = [];
    for (const label of labels) {
      cases.push(`case ${label}:`, [...this.block(1, context), ...(random.chance(0.7) ? ["break;"] : [])]);
    }
    if (random.chance(0.7)) cases.splice(random.chance(0.8) ? cases.length : 0, 0, `default:`, [...this.block(1, context), ...(random.chance(0.5) ? ["break;"] : [])]);
    return [`switch (${subject}) {`, cases, `}`];
  }

  tryStatement(context: Context): Code[] {
    const { random } = this;
    this.need("errorName");
    this.need("log");
    const thrown = random.pick([`new Error("own ${this.fresh("e")}")`, `new RangeError("own r")`, `new TypeError("own t")`, this.int32(0), this.string(0)]);
    return [
      `try {`,
      [...this.block(1, context), `if (${this.boolean(1)}) throw ${thrown};`, ...this.block(1, context)],
      `} catch (error) {`,
      [`log.push(errorName(error));`],
      ...(random.chance(0.5) ? [`} finally {`, this.block(1, context)] : []),
      `}`,
    ];
  }

  // Ways to run statements from a place that an analysis has to see through.

  /** An expression whose value is the text, put together at run time. */
  computedKey(text: string): string {
    const { random } = this;
    const quoted = JSON.stringify(text);
    return random.weighted<string>([
      [1, quoted],
      [2, `[${quoted}].join("")`],
      [2, `${JSON.stringify(text + "~")}.slice(0, ${text.length})`],
      [2, `(${JSON.stringify(text.slice(0, 1))} + ${JSON.stringify(text.slice(1))})`],
      [1, `String.fromCharCode(${[...text].map(character => character.charCodeAt(0)).join(", ")})`],
      [1, `Object.keys({ ${quoted}: 0 })[0]`],
      [1, "`${" + quoted + "}`"],
    ]);
  }

  /**
   * Code that runs the statements exactly once. They may not use `this` or `await`, or declare anything that is used afterwards.
   * `bare` leaves out the ways that go through a built-in a program may replace.
   */
  indirectly(statements: Code[], bare = false): Code[] {
    const { random } = this;
    const a = (type: string) => this.annotation(type);
    const name = this.fresh("t");
    const returning = (value: string): Code[] => [...statements, `return ${value};`];
    const options: [number, () => Code[]][] = [
      [2, () => statements],
      [2, () => [`const ${name}${a("(() => void)[]")} = [() => {}, () => {`, statements, `}];`, `for (const action of ${name}) action();`]],
      [2, () => [`let ${name} = true;`, `[3, 1, 2].sort((a, b) => {`, [`if (${name}) {`, [`${name} = false;`, ...statements], `}`, `return a - b;`], `});`]],
      [2, () => [`"abc".replace("b", () => {`, returning('"x"'), `});`]],
      [1, () => [`"abc".replace(/b/, () => {`, returning('"x"'), `});`]],
      [2, () => [`void { get trigger() {`, returning("1"), `} }.trigger;`]],
      [2, () => [`void +{ valueOf() {`, returning("1"), `} };`]],
      [2, () => ["void `${{ toString() {", returning('"t"'), "} }}`;"]],
      [1, () => [`void (${this.cast(`{ [Symbol.toPrimitive]() {`, "").slice(0, 0)}${this.typed ? "(" : ""}{ [Symbol.toPrimitive]() {`, returning("2"), `} }${this.typed ? " as any)" : ""} * 2);`]],
      [2, () => [`void new Proxy${this.typeArguments("any")}({}, { get() {`, returning("1"), `} }).anything;`]],
      [1, () => [`void ("key" in new Proxy({}, { has() {`, returning("true"), `} }));`]],
      [2, () => [`void [...{ *[Symbol.iterator]() {`, [...statements, `yield 1;`], `} }];`]],
      [1, () => [`const [${name}] = { [Symbol.iterator]() {`, returning("[1].values()"), `} };`]],
      [1, () => [`void ({} instanceof ${this.typed ? "(" : ""}{ [Symbol.hasInstance]() {`, returning("true"), `} }${this.typed ? " as any)" : ""});`]],
      [1, () => [`(function () {`, statements, `}).${random.pick(["call(undefined)", "apply(null, [])", "bind(null)()"])};`]],
      [1, () => [`new ${random.pick(["Set([1])", "Map([[1, 1]])"])}.forEach(() => {`, statements, `});`]],
      [2, () => [`[1].${random.pick(["forEach", "map", "some", "find", "filter", "every", "findLast", "reduce"])}(() => {`, returning("0"), `}${""});`]],
      [1, () => [`({ set trigger(value${a("number")}) {`, statements, `} }).trigger = 1;`]],
      [1, () => [`((value = (() => {`, returning("1"), `})()) => value)();`]],
      [1, () => [`try {`, [`void 0;`], `} finally {`, statements, `}`]],
      [1, () => [`try {`, [`throw 1;`], `} catch {`, statements, `}`]],
      [1, () => [`(function* () {`, [...statements, `yield 1;`], `})().next();`]],
      [1, () => [`void class { static {`, statements, `} };`]],
      [1, () => [`new (class { field = (() => {`, returning("1"), `})(); })();`]],
      [1, () => [`void class { static [(() => {`, returning('"computed"'), `})()]() {} };`]],
      [1, () => [`((strings${a("TemplateStringsArray")}) => {`, statements, "})`x`;"]],
      [1, () => [`void { [(() => {`, returning('"computed"'), `})()]: 1 };`]],
      [1, () => [`switch (1) {`, [`case (() => {`, returning("1"), `})():`], `}`]],
      [2, () => [`await { then(resolve${a("(value: number) => void")}) {`, [...statements, `resolve(1);`], `} };`]],
      [1, () => [`await Promise.resolve().then(() => {`, statements, `});`]],
      [1, () => [`await (async () => {`, [`await null;`, ...statements], `})();`]],
      [1, () => [`for await (const ${name} of (async function* () {`, [...statements, `yield 1;`], `})());`]],
    ];
    if (!bare) {
      options.push(
        [2, () => [`JSON.stringify({ toJSON() {`, returning("0"), `} });`]],
        [1, () => [`JSON.stringify([1], (key, value) => {`, [`if (key === "0") {`, statements, `}`, `return value;`], `});`]],
        [1, () => [`JSON.parse("1", () => {`, statements, `});`]],
        [2, () => [`Array.from({ length: 1 }, () => {`, statements, `});`]],
        [2, () => [`Reflect.apply(() => {`, statements, `}, undefined, []);`]],
        [1, () => [`Reflect.construct(function () {`, statements, `}, []);`]],
        [1, () => [`Object.defineProperty({}, "key", { get value() {`, returning("1"), `} });`]],
        [1, () => [`Object.assign({}, { get source() {`, returning("1"), `} });`]],
        [1, () => [`Object.entries({ get entry() {`, returning("1"), `} });`]],
        [1, () => [`void { ...{ get spread() {`, returning("1"), `} } };`]],
        [1, () => [`Math.max(${this.cast(`{ valueOf() {`, "").slice(0, 0)}${this.typed ? "(" : ""}{ valueOf() {`, returning("1"), `} }${this.typed ? " as any)" : ""});`]],
        [1, () => [`String({ toString() {`, returning('"s"'), `} });`]],
        [1, () => [`new Map([[1, 1]]).forEach(function () {`, statements, `});`]],
      );
    }
    return this.choose(options);
  }
}

// Features.

function declareClass(g: Generator, parent?: ClassModel): ClassModel {
  const { random } = g;
  const name = g.fresh("C");
  const inherited = parent ? fieldsOf({ is: "instance", of: parent }).map(field => field.name) : [];
  const fields = random.sample(fieldNames.filter(field => !inherited.includes(field)), random.between(1, 3)).map(field => ({ name: field, kind: g.fieldKinds.get(field)! }));
  const model: ClassModel = { name, type: name, isFunction: false, parent, fields, methods: [], parameters: [...(parent?.parameters ?? [])] };
  const self: Variable[] = fieldsOf({ is: "instance", of: model }).map(field => ({ name: `this.${field.name}`, kind: field.kind, mutable: true }));
  const members: Code[] = [];
  const parameters = (parent?.parameters ?? []).map((kind, i) => ({ name: `a${i}`, kind, mutable: false }));
  const stores: Code[] = parent ? [`super(${parameters.map(parameter => parameter.name).join(", ")});`] : [];
  for (const field of fields) {
    if (random.chance(0.6)) {
      const parameter = { name: `a${parameters.length}`, kind: field.kind, mutable: false };
      parameters.push(parameter);
      model.parameters.push(field.kind);
      members.push(`${field.name}${g.annotation(field.kind)};`);
      stores.push(`this.${field.name} = ${parameter.name};`);
    } else {
      members.push(`${field.name}${g.annotation(field.kind)} = ${g.scoped([], () => g.expression(field.kind, 1))};`);
    }
  }
  const secret = random.chance(0.4) ? `#${random.pick(["secret", "hidden"])}` : undefined;
  if (secret) {
    members.push(`${secret}${g.annotation(int32)} = ${g.int32(0)};`);
    self.push({ name: `this.${secret}`, kind: int32, mutable: true });
  }
  const counter = random.chance(0.4);
  if (counter) {
    members.push(`static made = 0;`);
    stores.push(`${name}.made++;`);
  }
  members.push(`constructor(${parameters.map(parameter => parameter.name + g.annotation(parameter.kind)).join(", ")}) {`, stores, `}`);
  const overridable = parent ? methodsOf(parent) : [];
  for (const method of random.sample(overridable, random.below(2))) {
    const list = method.parameters.map((kind, i) => ({ name: `p${i}`, kind, mutable: false }));
    const call = `super.${method.name}(${list.map(parameter => parameter.name).join(", ")})`;
    const body = g.scoped([...self, ...list, { name: call, kind: method.result, mutable: false }], () => g.expression(method.result, 2));
    members.push(`${method.name}(${list.map(parameter => parameter.name + g.annotation(parameter.kind)).join(", ")})${g.annotation(method.result)} {`, [`return ${random.chance(0.6) ? combine(g, call, body, method.result) : body};`], `}`);
    model.methods.push(method);
  }
  const taken = new Set(overridable.map(method => method.name));
  for (const methodName of random.sample(methodNames.filter(candidate => !taken.has(candidate)), random.between(1, 2))) {
    const method: Method = { name: methodName, parameters: Array.from({ length: random.below(3) }, () => g.someKind(true)), result: g.someKind(true) };
    const list = method.parameters.map((kind, i) => ({ name: `p${i}`, kind, mutable: false }));
    const body = g.scoped([...self, ...list], () => [
      ...(random.chance(0.4) ? g.statements(1, { top: false, loops: 0, depth: 1 }) : []),
      `return ${g.expression(method.result, 2)};`,
    ]);
    members.push(`${methodName}(${list.map(parameter => parameter.name + g.annotation(parameter.kind)).join(", ")})${g.annotation(method.result)} {`, body, `}`);
    model.methods.push(method);
  }
  if (!parent && random.chance(0.3)) {
    const method: Method = { name: "act", parameters: [], result: g.someKind(true) };
    members.push(`act = ()${g.annotation(method.result)} => ${g.withoutCalls(() => g.scoped(self, () => g.expression(method.result, 1)))};`);
    model.methods.push(method);
  }
  const numeric = fields.find(field => field.kind.is === "int32" || field.kind.is === "number");
  if (numeric && random.chance(0.4)) {
    members.push(`get twice()${g.annotation(number)} {`, [`return this.${numeric.name} * 2;`], `}`);
    members.push(`set twice(value${g.annotation(number)}) {`, [`this.${numeric.name} = value / 2;`], `}`);
  }
  if (counter && random.chance(0.5)) members.push(`static {`, [`${name}.made = ${g.int32(0)};`], `}`);
  g.emit(`class ${name}${parent ? ` extends ${parent.name}` : ""} {`, members, `}`);
  g.classes.push(model);
  return model;
}

/** Joins two expressions of one primitive kind into one. */
function combine(g: Generator, left: string, right: string, kind: Kind): string {
  switch (kind.is) {
    case "int32":
      return `(${left} + ${right}) | 0`;
    case "number":
    case "string":
    case "bigint":
      return `${left} + ${right}`;
    case "boolean":
      return `${left} !== ${right}`;
    default:
      return left;
  }
}

function makeInstances(g: Generator, model: ClassModel, count: number): void {
  for (let i = 0; i < count; i++) {
    const name = g.fresh("o");
    g.emit(`const ${name}${g.random.chance(0.5) || model.isFunction ? g.annotation(model.type) : ""} = ${g.construct(model, g.argumentsFor(model.parameters, 1))};`);
    g.emit(...g.look(g.declare(name, { is: "instance", of: model })));
  }
}

function classes(g: Generator): void {
  let model = declareClass(g);
  makeInstances(g, model, 1);
  for (let depth = g.random.below(3); depth > 0; depth--) {
    model = declareClass(g, model);
    makeInstances(g, model, 1);
  }
}

function declareShape(g: Generator): Shape {
  const fields = g.random.sample(fieldNames, g.random.between(1, 4)).map(name => ({ name, kind: g.fieldKinds.get(name)! }));
  const shape = { name: g.fresh("S"), fields };
  g.emitType(`type ${shape.name} = { ${fields.map(field => `${field.name}: ${g.typeText(field.kind)}`).join("; ")} };`);
  g.shapes.push(shape);
  return shape;
}

function records(g: Generator): void {
  const shape = declareShape(g);
  const kind: Kind = { is: "record", shape };
  for (let i = g.random.between(1, 3); i > 0; i--) {
    const name = g.fresh("r");
    g.emit(`const ${name}${g.annotation(kind)} = ${g.scoped([], () => g.record(shape, 2))};`);
    g.declare(name, kind);
  }
  g.emit(...g.look(g.variable(candidate => same(candidate, kind))!));
}

function functions(g: Generator): void {
  const { random } = g;
  for (let i = random.between(1, 2); i > 0; i--) {
    const name = g.fresh("f");
    const kind: Kind = { is: "function", parameters: Array.from({ length: random.below(4) }, () => g.someKind()), result: g.someKind(true) };
    const parameters = kind.parameters.map((parameter, index) => ({ name: `p${index}`, kind: parameter, mutable: random.chance(0.3) }));
    const body = g.scoped(parameters, () => [...g.statements(random.between(1, 4), { top: false, loops: 0, depth: 2 }), `return ${g.expression(kind.result, 2)};`]);
    g.emit(`function ${name}(${parameters.map(parameter => parameter.name + g.annotation(parameter.kind)).join(", ")})${g.annotation(kind.result)} {`, body, `}`);
    const variable = g.declare(name, kind);
    g.emit(...g.look(variable));
  }
}

function closures(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const kind: Kind = { is: "function", parameters: [], result: int32 };
  if (random.chance(0.5)) {
    const make = g.fresh("makeCounter");
    const step = g.int32(0);
    g.emit(`function ${make}(start${a("number")})${a("() => number")} {`, [`let current = start;`, `return () => (current = (current + ${step}) | 0);`], `}`);
    for (let i = random.between(1, 2); i > 0; i--) {
      const name = g.fresh("next");
      g.emit(`const ${name} = ${make}(${g.int32(1)});`);
      g.declare(name, kind);
      g.emit(`print("${name} " + ${name}() + " " + ${name}());`);
    }
  } else {
    const list = g.fresh("closures");
    const declaration = random.pick(["let", "var"]);
    g.emit(
      `const ${list}${a("(() => number)[]")} = [];`,
      `for (${declaration} i = 0; i < ${random.between(2, 4)}; i++) ${list}.push(() => (i * ${g.int32(0)}) | 0);`,
      `print("${list} " + ${g.listing(list, "closure", "closure()")});`,
    );
    g.declare(list, arrayOf(kind));
  }
}

function arrays(g: Generator): void {
  const { random } = g;
  const element = random.weighted<Kind>([[4, int32], [2, number], [2, string], [2, mixedOf(int32)], [1, bigint]]);
  const kind = arrayOf(element);
  const name = g.fresh("list");
  g.emit(`const ${name}${g.annotation(kind)} = ${g.array(element, 1)};`);
  const variable = g.declare(name, kind);
  for (let i = random.between(1, 4); i > 0; i--) g.emit(...(g.arrayMutation() ?? []));
  g.emit(...g.look(variable));
  if (element.is === "int32" || element.is === "number") {
    g.emit(`print("${name} sum " + ${name}.reduce((sum, item) => sum + item, 0) + " " + ${name}.join("+") + " " + ${name}.indexOf(${g.expression(element, 0)}) + " " + ${name}.includes(NaN));`);
  }
}

function collections(g: Generator): void {
  const { random } = g;
  const key = random.weighted<Kind>([[3, int32], [2, string], [2, number]]);
  const name = g.fresh("table");
  if (random.chance(0.6)) {
    const kind: Kind = { is: "map", key, value: random.pick([int32, string, number]) };
    g.emit(`const ${name} = new Map${g.typeArguments(`${g.typeText(kind.key)}, ${g.typeText(kind.value)}`)}();`);
    g.declare(name, kind);
    for (let i = random.between(2, 5); i > 0; i--) g.emit(`${name}.set(${g.expression(key, 1)}, ${g.expression(kind.value, 1)});`);
    if (key.is === "number") g.emit(`${name}.set(NaN, ${g.expression(kind.value, 0)}).set(-0, ${g.expression(kind.value, 0)});`);
    g.emit(`print("${name} " + ${name}.size + " " + ${g.listing(name, "[key, value]", `key + "=" + value`, false)});`);
  } else {
    const kind: Kind = { is: "set", element: key };
    g.emit(`const ${name} = new Set${g.typeArguments(g.typeText(key))}(${g.array(key, 1)});`);
    g.declare(name, kind);
    for (let i = random.between(1, 3); i > 0; i--) g.emit(`${name}.add(${g.expression(key, 1)});`);
    g.emit(`print("${name} " + ${name}.size + " " + ${g.listing(name, "item", "String(item)", false)});`);
  }
}

/** One function that reads a few fields, called with every object in scope that has them. */
function readers(g: Generator): boolean {
  const { random } = g;
  const holders = g.variables(kind => fieldsOf(kind).length > 0);
  if (holders.length === 0) return false;
  const fields = random.sample(fieldsOf(random.pick(holders).kind), random.between(1, 2));
  const shape: Shape = { name: `{ ${fields.map(field => `${field.name}: ${g.typeText(field.kind)}`).join("; ")} }`, fields };
  const name = g.fresh("read");
  const result = g.someKind(true);
  const body = g.scoped([{ name: "o", kind: { is: "record", shape }, mutable: false }], () => g.expression(result, 2));
  const direct = fields.map(field => g.textOf(`o.${field.name}`, field.kind)).join(` + "," + `);
  g.emit(`function ${name}(o${g.annotation(shape.name)})${g.annotation(string)} {`, [`return ${direct} + ";" + ${g.textOf(body, result)};`], `}`);
  const takers = holders.filter(holder => fields.every(field => fieldsOf(holder.kind).some(candidate => candidate.name === field.name)));
  const first = random.pick(takers);
  g.need("mix");
  g.emit(`for (let i = 0; i < ${random.pick([3, 10, 50])}; i++) mix(${name}(${first.name}).length);`);
  for (const taker of takers) g.emit(`print("${name} " + ${name}(${taker.name}));`);
  g.readers.push({ name, fields });
  return true;
}

function signature(g: Generator, parameters: Variable[], receiver?: string): string {
  const list = parameters.map(parameter => parameter.name + g.annotation(parameter.kind));
  if (receiver && g.typed) list.unshift(`this: ${receiver}`);
  return list.join(", ");
}

/** `function F() {}` or `var F = function () {}` with methods assigned to its prototype. */
function constructorFunctions(g: Generator): void {
  const { random } = g;
  const name = g.fresh("F");
  const fields = random.sample(fieldNames, random.between(1, 3)).map(field => ({ name: field, kind: g.fieldKinds.get(field)! }));
  const model: ClassModel = { name, type: `${name}Instance`, isFunction: true, fields, methods: [], parameters: fields.map(field => field.kind) };
  for (const method of random.sample(methodNames, random.between(1, 2))) {
    model.methods.push({ name: method, parameters: Array.from({ length: random.below(2) }, () => g.someKind(true)), result: g.someKind(true) });
  }
  const members = [
    ...fields.map(field => `${field.name}: ${g.typeText(field.kind)}`),
    ...model.methods.map(method => `${method.name}(${method.parameters.map((kind, i) => `p${i}: ${g.typeText(kind)}`).join(", ")}): ${g.typeText(method.result)}`),
  ];
  g.emitType(`type ${model.type} = { ${members.join("; ")} };`);
  const parameters = fields.map((field, i) => ({ name: `a${i}`, kind: field.kind, mutable: false }));
  const asExpression = random.chance(0.5);
  g.emit(
    `${asExpression ? `${random.pick(["var", "const"])} ${name} = function` : `function ${name}`}(${signature(g, parameters, model.type)}) {`,
    fields.map((field, i) => `this.${field.name} = a${i};`),
    asExpression ? `};` : `}`,
  );
  const self = fields.map(field => ({ name: `this.${field.name}`, kind: field.kind, mutable: true }));
  const bodies = model.methods.map(method => {
    const list = method.parameters.map((kind, i) => ({ name: `p${i}`, kind, mutable: false }));
    return { method, list, body: g.scoped([...self, ...list], () => `return ${g.expression(method.result, 2)};`) };
  });
  if (random.chance(0.7)) {
    for (const { method, list, body } of bodies) g.emit(`${name}.prototype.${method.name} = function (${signature(g, list, model.type)})${g.annotation(method.result)} {`, [body], `};`);
  } else {
    g.emit(
      `${name}.prototype = {`,
      [`constructor: ${name},`, ...bodies.flatMap(({ method, list, body }): Code[] => [`${method.name}(${signature(g, list, model.type)})${g.annotation(method.result)} {`, [body], `},`])],
      `};`,
    );
  }
  g.classes.push(model);
  makeInstances(g, model, random.between(1, 2));
}

/** Classes that extend Array, Map, Set, Error and Promise. Their instances stand among the plain arrays, maps and sets in scope. */
function builtinSubclasses(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const name = g.fresh("B");
  const variable = g.fresh("b");
  g.need("mix");
  switch (random.pick(["Array", "Array", "Map", "Set", "Error", "Promise"])) {
    case "Array": {
      const species = random.pick(["", "", `static get [Symbol.species]() { return Array; }`]);
      g.emit(
        `class ${name} extends Array${g.typeArguments("number")} {`,
        [`extra${a("number")} = ${g.int32(0)};`, `last()${a("number")} {`, [`return this[this.length - 1] + this.extra;`], `}`, ...(species ? [species] : [])],
        `}`,
        `const ${variable} = ${random.pick([`new ${name}()`, `${name}.of(${g.int32(0)}, ${g.int32(0)})`, `${name}.from([${g.int32(0)}])`])}${g.typed ? ` as ${name}` : ""};`,
        `${variable}.push(${g.int32(1)}, ${g.int32(1)});`,
        `print("${variable} " + ${variable}.length + " " + ${variable}.last() + " " + ${variable}.join() + " " + Array.isArray(${variable}) + " " + ${g.keysOf(variable)});`,
        `print("${variable} heirs " + (${variable}.map(item => item + 1) instanceof ${name}) + " " + (${variable}.slice(1) instanceof ${name}) + " " + (${variable}.concat([1]).constructor === ${name}) + " " + ([...${variable}] instanceof ${name}));`,
      );
      g.declare(variable, arrayOf(int32));
      break;
    }
    case "Map": {
      g.emit(
        `class ${name} extends Map${g.typeArguments("string, number")} {`,
        [
          `reads${a("number")} = 0;`,
          `get(key${a("string")})${a("number | undefined")} {`,
          [`this.reads++;`, `return super.get(key);`],
          `}`,
          `set(key${a("string")}, value${a("number")})${a("this")} {`,
          [`mix(value);`, `return super.set(key${random.chance(0.3) ? ".toUpperCase()" : ""}, value);`],
          `}`,
        ],
        `}`,
        `const ${variable} = new ${name}([[${g.string(0)}, ${g.int32(0)}], [${g.string(0)}, ${g.int32(0)}]]);`,
        `${variable}.set(${g.string(1)}, ${g.int32(1)});`,
        `print("${variable} " + ${variable}.size + " " + ${variable}.get(${g.string(0)}) + " " + ${variable}.reads + " " + [...${variable}.keys()].join() + " " + (${variable} instanceof Map));`,
      );
      g.declare(variable, { is: "map", key: string, value: int32 });
      break;
    }
    case "Set": {
      g.emit(
        `class ${name} extends Set${g.typeArguments("number")} {`,
        [`added${a("number")} = 0;`, `add(value${a("number")})${a("this")} {`, [`this.added = (this.added | 0) + 1;`, `return super.add(value ${random.pick(["| 0", "& 7", "+ 0"])});`], `}`],
        `}`,
        `const ${variable} = new ${name}([${g.int32(0)}, ${g.number(0)}, ${g.int32(0)}]);`,
        `${variable}.add(${g.int32(1)});`,
        `print("${variable} " + ${variable}.size + " " + ${variable}.added + " " + [...${variable}].join());`,
      );
      g.declare(variable, { is: "set", element: int32 });
      break;
    }
    case "Error": {
      const base = random.pick(["Error", "TypeError", "RangeError"]);
      g.need("errorName");
      g.emit(
        `class ${name} extends ${base} {`,
        [`code${a("number")};`, `constructor(message${a("string")}, code${a("number")}) {`, [`super(message);`, `this.code = code;`, ...(random.chance(0.5) ? [`this.name = "${name}";`] : [])], `}`],
        `}`,
        `try {`,
        [`throw new ${name}("own " + ${g.string(1)}, ${g.int32(1)});`],
        `} catch (error) {`,
        [
          `print("${variable} " + errorName(error) + " " + (error instanceof ${name}) + " " + (error instanceof ${base}) + " " + (error instanceof ${name} ? error.code + " " + error.name + " " + String(error) + " " + Object.hasOwn(error, "code") + Object.hasOwn(error, "name") : "other"));`,
        ],
        `}`,
      );
      break;
    }
    default: {
      g.emit(
        `class ${name}${g.typeArguments("T")} extends Promise${g.typeArguments("T")} {`,
        [`static made = 0;`, `constructor(executor${a("(resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void")}) {`, [`super(executor);`, `${name}.made++;`], `}`],
        `}`,
        `const ${variable} = ${name}.resolve(${g.int32(1)}).then(value => value + 1);`,
        `print("${variable} " + (${variable} instanceof ${name}) + " " + ${name}.made + " " + (await ${variable}) + " " + (Promise.resolve(${variable}) === ${variable}) + " " + (${name}.resolve(${variable}) === ${variable}));`,
      );
    }
  }
}

function generators(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const name = g.fresh("gen");
  g.need("log");
  g.need("errorName");
  const counter: Variable = { name: "i", kind: int32, mutable: false };
  const delegate = random.pick([undefined, `yield* [${g.int32(0)}, ${g.int32(0)}];`, `yield* new Set([${g.int32(0)}]);`]);
  g.emit(
    `function* ${name}(limit${a("number")})${a("Generator<number, string, number | undefined>")} {`,
    [
      `try {`,
      [
        `for (let i = 0; i < limit; i++) {`,
        [`const sent = yield ${g.scoped([counter], () => g.int32(2))};`, `if (sent !== undefined) log.push("sent" + sent);`],
        `}`,
        ...(delegate ? [delegate] : []),
        `return "done";`,
      ],
      ...(random.chance(0.4) ? [`} catch (error) {`, [`log.push("inside " + errorName(error));`, ...(random.chance(0.5) ? [`yield -1;`] : []), `return "recovered";`]] : []),
      `} finally {`,
      [`log.push("${name} closed");`],
      `}`,
    ],
    `}`,
  );
  const step = (call: string) => `(step => step.value + "/" + step.done)(${call})`;
  const uses: (() => Code[])[] = [
    () => {
      const it = g.fresh("it");
      return [
        `const ${it} = ${name}(${random.between(1, 3)});`,
        `print("${it} " + ${[`${it}.next()`, `${it}.next(${g.int32(0)})`, random.pick([`${it}.return("early")`, `${it}.next()`]), `${it}.next()`].map(step).join(` + " " + `)});`,
      ];
    },
    () => {
      const it = g.fresh("it");
      return [`const ${it} = ${name}(3);`, ...(random.chance(0.7) ? [`${it}.next();`] : []), ...g.attempt([`"${it} thrown " + ${step(`${it}.throw(new RangeError("own thrown"))`)} + " " + ${step(`${it}.next()`)}`])];
    },
    () => [`for (const value of ${name}(5)) {`, [`if (value ${random.pick([">", "<", "==="])} ${g.int32(0)}) ${random.pick(["break", "continue"])};`, `log.push("v" + value);`], `}`],
    () => [`print("${g.fresh("spread")} " + [...${name}(${random.below(4)})].join() + " " + Math.max(...${name}(2)) + " " + Array.from(${name}(2), value => value * 2).join());`],
    () => {
      const [first, third, rest] = [g.fresh("first"), g.fresh("third"), g.fresh("rest")];
      g.declare(first, number);
      return [`const [${first}, , ${third} = ${g.int32(0)}, ...${rest}] = ${name}(${random.between(0, 5)});`, `print("${first} " + ${first} + " " + ${third} + " " + ${rest}.join());`];
    },
    () => [`const [${g.fresh("only")}] = ${name}(4);`],
    () => {
      const self = g.fresh("self");
      return [
        `const ${self}${a("{ it?: Generator<number> }")} = {};`,
        `${self}.it = (function* () {`,
        [`try {`, [`${self}.it?.next();`], `} catch (error) {`, [`log.push("reentered " + errorName(error));`], `}`, `yield 1;`],
        `})();`,
        `${self}.it.next();`,
      ];
    },
  ];
  g.emitSome(uses, random.between(2, 3));
  g.emit(`flush("${name}");`);
}

function asyncOrder(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const order = g.fresh("order");
  const work = g.fresh("work");
  const ticks = g.fresh("ticks");
  g.need("errorName");
  g.emit(
    `const ${order}${a("string[]")} = [];`,
    `async function ${work}(tag${a("string")}, turns${a("number")})${a("Promise<string>")} {`,
    [`${order}.push(tag + " starts");`, `for (let i = 0; i < turns; i++) {`, [`await ${random.pick(["null", "i", "Promise.resolve(i)"])};`, `${order}.push(tag + i);`], `}`, `return tag;`],
    `}`,
  );
  const pieces: (() => Code[])[] = [
    () => [`Promise.resolve(${g.int32(1)}).then(value => ${order}.push("then " + value)).then(value => ${order}.push("length " + value));`],
    () => [`${work}("a", ${random.below(3)}).then(tag => ${order}.push("done " + tag));`],
    () => [`${work}("b", ${random.below(3)}).then(tag => ${order}.push("done " + tag));`],
    () => [`Promise.resolve({ then(resolve${a("(value: number) => void")}) {`, [`${order}.push("then is called");`, `resolve(${g.int32(0)});`], `} }).then(value => ${order}.push("thenable " + value));`],
    () => [`Promise.reject(new Error("own rejected")).catch(error => ${order}.push(errorName(error))).finally(() => ${order}.push("finally"));`],
    () => [
      `(async () => {`,
      [`try {`, [`await Promise.reject(new RangeError("own awaited"));`], `} catch (error) {`, [`${order}.push("caught " + errorName(error));`], `} finally {`, [`${order}.push("cleanup");`], `}`],
      `})();`,
    ],
    () => [`Promise.${random.pick(["all", "allSettled", "race", "any"])}([${g.int32(0)}, Promise.resolve(${g.int32(0)}), ${work}("c", 1)]).then(result => ${order}.push("combined " + JSON.stringify(result)));`],
    () => [
      `async function* ${ticks}(limit${a("number")}) {`,
      [`try {`, [`for (let i = 0; i < limit; i++) {`, [`${order}.push("tick" + i);`, `yield i;`], `}`], `} finally {`, [`${order}.push("ticks end");`], `}`],
      `}`,
      `(async () => {`,
      [`for await (const tick of ${ticks}(3)) {`, [`${order}.push("got" + tick);`, ...(random.chance(0.5) ? [`if (tick === 1) break;`] : [])], `}`],
      `})();`,
    ],
    () => [`new Promise${g.typeArguments("number")}(resolve => {`, [`${order}.push("executor");`, `resolve(${g.int32(0)});`, `${order}.push("resolved");`], `}).then(value => ${order}.push("made " + value));`],
    () => [`${order}.push("top " + (await ${work}("t", ${random.below(2)})));`],
    () => [`Promise.resolve().then(() => {`, [`${order}.push("outer");`, `Promise.resolve().then(() => ${order}.push("inner"));`], `}).then(() => ${order}.push("after outer"));`],
    () => [`${order}.push("awaited " + (await { then(resolve${a("(value: string) => void")}) { resolve("thenable"); } }));`],
    () => {
      const pending = g.fresh("pending");
      return [`const ${pending} = ${work}("d", ${random.below(3)});`, `${order}.push("started d");`, `${order}.push("joined " + (await ${pending}));`];
    },
    () => [`(async () => {`, [`${order}.push("nested " + (await ${work}("e", ${random.below(2)})));`], `})();`],
    () => [
      `try {`,
      [`await { then(resolve${a("(value: number) => void")}, reject${a("(reason: unknown) => void")}) {`, [`${order}.push("rejecting");`, `reject(new TypeError("own refused"));`], `} };`],
      `} catch (error) {`,
      [`${order}.push("refused " + errorName(error));`],
      `}`,
    ],
    () => [`${order}.push("value " + (await Promise.resolve(${g.int32(0)})) + (await ${g.int32(0)}));`],
    () => [`for (const flag of [true, false]) ${order}.push("maybe " + (await Promise.resolve(flag ? ${g.int32(0)} : { then(resolve${a("(value: string) => void")}) { resolve("from thenable"); } })));`],
    () => [`(async () => {`, [`await null;`, `${order}.push("one turn");`, `await null;`, `await null;`, `${order}.push("three turns");`], `})();`],
  ];
  g.emitSome(pieces, random.between(3, 5));
  g.emit(`${order}.push("sync end");`, `for (let i = 0; i < 12; i++) await null;`, `print("${order} " + ${order}.join(", "));`);
}

function destructuring(g: Generator): void {
  const { random } = g;
  const pieces: (() => Code[] | undefined)[] = [
    () => {
      const element = random.pick([int32, number]);
      const [first, second, rest] = [g.fresh("d"), g.fresh("d"), g.fresh("rest")];
      const code = [`const [${first} = ${g.expression(element, 1)}, ${second} = ${first}, ...${rest}] = ${g.cast(g.array(element, 1), g.typeText(arrayOf(element)))};`, `print("${first} " + ${first} + " " + ${second} + " " + ${rest}.length + ":" + ${rest}.join());`];
      g.declare(first, number);
      g.declare(rest, arrayOf(element));
      return code;
    },
    () => {
      const holder = g.variable(kind => fieldsOf(kind).length > 0);
      if (!holder) return undefined;
      const fields = fieldsOf(holder.kind);
      const field = random.pick(fields);
      const [picked, others] = [g.fresh("picked"), g.fresh("others")];
      const code = [`const { ${field.name}: ${picked}, ...${others} } = ${holder.name};`, `print("${picked} " + ${g.textOf(picked, field.kind)} + " " + ${g.keysOf(others)});`];
      g.declare(picked, field.kind);
      return code;
    },
    () => {
      const holder = g.variable(kind => fieldsOf(kind).length > 0);
      if (!holder) return undefined;
      const field = random.pick(fieldsOf(holder.kind));
      const picked = g.fresh("picked");
      return [`const { [${g.computedKey(field.name)}]: ${picked} } = ${g.cast(holder.name)};`, `print("${picked} " + ${g.show(picked)});`];
    },
    () => {
      const [head, tail, size] = [g.fresh("head"), g.fresh("tail"), g.fresh("size")];
      const text = g.string(1);
      const code = [`const [${head} = "none", ...${tail}] = ${text};`, `const { length: ${size} } = ${text};`, `print("${head} " + ${head} + " " + ${tail}.length + " " + ${size});`];
      g.declare(head, string);
      g.declare(size, int32);
      return code;
    },
    () => {
      const places = g.writablePlaces(kind => kind.is === "int32" || kind.is === "number");
      if (places.length < 2) return undefined;
      const [left, right] = random.sample(places, 2);
      return [`[${left.text}, ${right.text}] = [${right.text}, ${left.text}];`, `print("${g.fresh("swapped")} " + ${left.text} + " " + ${right.text});`];
    },
    () => {
      const take = g.fresh("take");
      const type = g.annotation("{ x?: number; pair?: number[] }");
      return [
        `function ${take}({ x = ${g.int32(0)}, pair: [p, q = p + x] = [${g.int32(0)}] }${type} = {})${g.annotation("string")} {`,
        [`return x + "," + p + "," + q;`],
        `}`,
        `print("${take} " + ${take}() + " " + ${take}({ x: ${g.int32(1)} }) + " " + ${take}({ pair: [${g.int32(0)}, ${g.int32(0)}] }) + " " + ${take}({ x: undefined, pair: [] }));`,
      ];
    },
    () => {
      const table = g.variable(kind => kind.is === "map");
      if (!table) return undefined;
      g.need("log");
      return [`for (const [key, value] of ${table.name}) log.push(key + "=>" + value);`, `flush("${g.fresh("entries")}");`];
    },
  ];
  g.emitSome(pieces, 3);
}

function spreads(g: Generator): void {
  const { random } = g;
  const collect = g.fresh("collect");
  g.emit(`function ${collect}(...values${g.annotation("any[]")})${g.annotation("string")} {`, [`return values.length + ":" + values.map(value => typeof value + String(value)).join();`], `}`);
  const sources = () =>
    random.weighted<string>([
      [3, `...${g.array(random.pick([int32, number, string]), 1)}`],
      [1, `...${g.string(1)}`],
      [1, `...new Set([${g.int32(0)}, ${g.int32(0)}])`],
      [1, `...new Map([[${g.int32(0)}, ${g.string(0)}]]).keys()`],
      [1, `...[${g.int32(0)}, , ${g.int32(0)}]`],
      [2, g.expression(g.someKind(true), 1)],
    ]);
  g.emit(`print("${collect} " + ${collect}(${sources()}, ${sources()}) + " " + ${collect}(${sources()}));`);
  const merged = g.fresh("merged");
  g.emit(`const ${merged}${g.annotation("any[]")} = [${sources()}, ${sources()}, ${sources()}];`);
  g.emit(...g.look(g.declare(merged, arrayOf(mixedOf(int32)))));
  const holder = g.variable(kind => kind.is === "record");
  if (holder && holder.kind.is === "record") {
    const field = random.pick(holder.kind.shape.fields);
    const copy = g.fresh("copy");
    const value = g.expression(field.kind, 1);
    g.emit(`const ${copy}${g.annotation(holder.kind)} = ${random.chance(0.5) ? `{ ...${holder.name}, ${field.name}: ${value} }` : `{ ${field.name}: ${value}, ...${g.cast(holder.name)} }`};`);
    g.emit(`print("${copy} " + ${g.keysOf(copy)} + " " + (${copy} === ${holder.name}) + " " + ${g.textOf(`${copy}.${field.name}`, field.kind)});`);
    g.declare(copy, holder.kind);
  }
  // A spread takes the fields of an instance and leaves its class behind.
  const instance = g.variable(kind => kind.is === "instance" && fieldsOf(kind).length > 0);
  if (instance) {
    const field = random.pick(fieldsOf(instance.kind));
    const own = g.fresh("own");
    g.emit(`const ${own} = { ...${instance.name} };`, `print("${own} " + ${g.keysOf(own)} + " " + (Object.getPrototypeOf(${own}) === Object.prototype) + " " + ${g.textOf(`${own}.${field.name}`, field.kind)});`);
  }
  if (random.chance(0.5)) g.emit(`print("${g.fresh("odd")} " + JSON.stringify({ ...${g.cast("null")}, ...${g.cast('"ab"')}, ...[${g.int32(0)}], ...${g.cast(g.int32(0))} }));`);
  if (random.chance(0.5)) g.emit(`print("${g.fresh("passed")} " + (function (..._${g.annotation("number[]")}) { return [...arguments].join() + arguments.length; })(${g.int32(0)}, ...[${g.int32(0)}, ${g.int32(0)}]));`);
}

function optionalChains(g: Generator): boolean {
  const { random } = g;
  const holder = g.variable(kind => fieldsOf(kind).length > 0);
  if (!holder) return false;
  const maybe = g.fresh("maybe");
  const missing = random.pick(["undefined", "null"]);
  const field = random.pick(fieldsOf(holder.kind));
  g.need("mix");
  g.emit(`function ${maybe}(present${g.annotation("boolean")})${g.annotation(`${g.typeText(holder.kind)} | ${missing}`)} {`, [`return present ? ${holder.name} : ${missing};`], `}`);
  const sights = [
    `String(${maybe}(true)?.${field.name})`,
    `String(${maybe}(false)?.${field.name})`,
    `String(${maybe}(${g.boolean(1)})?.${field.name} ?? "fallback")`,
    `String(${g.cast(`${maybe}(false)`)}?.[(mix(1), "${field.name}")])`,
    `String(${g.cast(`${maybe}(true)`)}?.[(mix(2), "${field.name}")])`,
    `String(${g.cast(`${maybe}(${g.boolean(1)})`)}?.missing?.deeper.still)`,
    `String(${g.cast(`${maybe}(true)`)}.missing?.(mix(3)))`,
    `String(delete ${g.cast(`${maybe}(false)`)}?.${field.name})`,
  ];
  if (holder.kind.is === "instance") {
    for (const method of methodsOf(holder.kind.of)) sights.push(`String(${maybe}(${g.boolean(1)})?.${method.name}?.(${g.argumentsFor(method.parameters, 0)}))`);
  }
  g.emit(`print("${maybe} " + ${random.sample(sights, random.between(3, 5)).join(` + " " + `)});`);
  return true;
}

/** return, break, continue and throw that leave through a finally block, which may replace them. */
function finallyFlow(g: Generator): void {
  const { random } = g;
  const name = g.fresh("flow");
  g.need("errorName");
  const action = (where: string) =>
    random.weighted<string>([
      [2, `return trace.join("") + " ${where}" + i;`],
      [2, `break;`],
      [2, `continue;`],
      [2, `throw new Error("own ${where}" + i);`],
      [1, `trace.push("${where}");`],
    ]);
  g.emit(
    `function ${name}(n${g.annotation("number")})${g.annotation("string")} {`,
    [
      `const trace${g.annotation("string[]")} = [];`,
      `for (let i = 0; i < 4; i++) {`,
      [
        `try {`,
        [`if (i === n) ${action("t")}`, `trace.push("b" + i);`, `if (i === ${random.below(4)}) ${action("u")}`],
        ...(random.chance(0.7) ? [`} catch (error) {`, [`trace.push("c" + errorName(error));`, `if (i === ${random.below(4)}) ${action("c")}`]] : []),
        `} finally {`,
        [`trace.push("f" + i);`, ...(random.chance(0.6) ? [`if (i === ${random.below(4)}) ${action("f")}`] : [])],
        `}`,
      ],
      `}`,
      `return trace.join("");`,
    ],
    `}`,
    `for (let n = 0; n < 5; n++) {`,
    g.guarded([`print("${name} " + n + " " + ${name}(n));`]),
    `}`,
  );
}

function symbols(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  g.need("log");
  const pieces: (() => Code[])[] = [
    () => {
      const [key, holder] = [g.fresh("key"), g.fresh("keyed")];
      g.declare(key, { is: "symbol" });
      return [
        `const ${key} = Symbol(${g.string(0)});`,
        `const ${holder} = { first: ${g.int32(0)}, [${key}]: ${g.int32(1)}, [Symbol.for("shared")]: ${g.string(0)}, last: ${g.int32(0)} };`,
        `${holder}[${key}]++;`,
        `print("${holder} " + ${holder}[${key}] + " " + ${g.listing(`Reflect.ownKeys(${holder})`, "name", `(typeof name === "symbol" ? "@" + name.description : name)`)} + " " + ${g.keysOf(holder)} + " " + (${key} in ${holder}) + " " + JSON.stringify(${holder}) + " " + Object.getOwnPropertySymbols({ ...${holder} }).length);`,
      ];
    },
    () => {
      const holder = g.fresh("primitive");
      return [
        `const ${holder} = { [Symbol.toPrimitive](hint${a("string")}) {`,
        [`log.push(hint);`, `return hint === "number" ? ${g.int32(0)} : hint === "string" ? ${g.string(0)} : ${random.chance(0.5) ? g.int32(0) : g.string(0)};`],
        `} };`,
        `print("${holder} " + +${holder} + " " + \`\${${holder}}\` + " " + (${g.cast(holder)} + 1) + " " + (${g.cast(holder)} * 2) + " " + (${g.cast(holder)} == ${g.int32(0)}) + " " + [1, 2, 3][${g.cast(holder)}] + " " + String(${holder}) + " " + (${g.cast(holder)} < 5));`,
        `flush("${holder}");`,
      ];
    },
    () => {
      const name = g.fresh("Even");
      return [
        `class ${name} {`,
        [`static [Symbol.hasInstance](value${a("unknown")})${a("boolean")} {`, [`return typeof value === "number" && value % ${random.between(2, 3)} === 0;`], `}`],
        `}`,
        `print("${name} " + ${g.listing(`[${g.int32(0)}, ${g.int32(0)}, 6, "6"]`, "value", `(${g.cast("value")} instanceof ${name})`)} + " " + (new ${name}() instanceof ${name}));`,
      ];
    },
    () => {
      const range = g.fresh("range");
      const closes = random.chance(0.6);
      return [
        `const ${range} = {`,
        [
          `from: ${random.below(3)},`,
          `to: ${random.between(2, 5)},`,
          `[Symbol.iterator]() {`,
          [
            `let current = this.from;`,
            `const last = this.to;`,
            `return {`,
            [
              `next: () => (current <= last ? { value: current++, done: false } : { value: -1, done: true }),`,
              ...(closes ? [`return() {`, [`log.push("${range} closed at " + current);`, `return { value: -1, done: true };`], `},`] : []),
            ],
            `};`,
          ],
          `},`,
        ],
        `};`,
        `const [${g.fresh("a")}, ${g.fresh("b")}] = ${range};`,
        `for (const value of ${range}) {`,
        [`if (value > ${random.between(1, 4)}) break;`, `log.push("r" + value);`],
        `}`,
        `print("${range} " + [...${range}].join() + " " + Math.min(...${range}) + " " + new Set(${range}).size + " " + Array.from(${range}).length);`,
        `flush("${range}");`,
      ];
    },
    () => {
      const tagged = g.fresh("Tagged");
      return [
        `class ${tagged} {`,
        [`get [Symbol.toStringTag]() {`, [`return ${g.string(0)};`], `}`],
        `}`,
        `print("${tagged} " + Object.prototype.toString.call(new ${tagged}()) + " " + String(new ${tagged}()) + " " + Object.prototype.toString.call([]) + Object.prototype.toString.call(null) + Object.prototype.toString.call(() => 1));`,
      ];
    },
    () => [
      `print("${g.fresh("registry")} " + (Symbol.for("a") === Symbol.for("a")) + " " + (Symbol("a") === Symbol("a")) + " " + Symbol.keyFor(Symbol.for("a")) + " " + Symbol.keyFor(Symbol.iterator) + " " + Symbol("d").description + " " + Symbol().description + " " + Symbol("t").toString() + " " + typeof Object(Symbol.iterator));`,
    ],
    () => {
      const list = g.fresh("spreadable");
      return [
        `const ${list}${a("any")} = { length: 2, 0: ${g.int32(0)}, 1: ${g.string(0)}, [Symbol.isConcatSpreadable]: true };`,
        `const ${list}Closed${a("any[]")} = [${g.int32(0)}, ${g.int32(0)}];`,
        `${list}Closed[Symbol.isConcatSpreadable${g.typed ? " as any" : ""}] = false;`,
        `print("${list} " + [0].concat(${list}).length + " " + [0].concat(${list}Closed).length + " " + JSON.stringify([0].concat(${list}, ${list}Closed)));`,
      ];
    },
    () => {
      const custom = g.fresh("pattern");
      return [
        `const ${custom}${a("any")} = {`,
        [
          `[Symbol.replace](text${a("string")}, with_${a("string")}) {`,
          [`return "<" + text + "|" + with_ + ">";`],
          `},`,
          `[Symbol.split](text${a("string")}) {`,
          [`return [text.length, "parts"];`],
          `},`,
          `[Symbol.match](text${a("string")}) {`,
          [`return [text.toUpperCase()];`],
          `},`,
          `[Symbol.search]() {`,
          [`return ${g.int32(0)};`],
          `},`,
        ],
        `};`,
        `print("${custom} " + ${g.string(0)}.replace(${custom}, "w") + " " + ${g.string(0)}.split(${custom}).join() + " " + ${g.string(0)}.match(${custom}) + " " + "s".search(${custom}));`,
      ];
    },
  ];
  g.emitSome(pieces, random.between(1, 3));
}

function taggedTemplates(g: Generator): void {
  const { random } = g;
  const [tag, seen, use] = [g.fresh("tag"), g.fresh("seen"), g.fresh("use")];
  g.emit(
    `const ${seen}${g.annotation("TemplateStringsArray[]")} = [];`,
    `function ${tag}(strings${g.annotation("TemplateStringsArray")}, ...values${g.annotation("unknown[]")})${g.annotation("string")} {`,
    [`${seen}.push(strings);`, `return strings.join("_") + "|" + strings.raw.join("_") + "|" + values.join();`],
    `}`,
    `function ${use}(value${g.annotation("number")})${g.annotation("string")} {`,
    ["return " + tag + "`a${value}\\n${" + g.scoped([{ name: "value", kind: int32, mutable: false }], () => g.expression(g.someKind(true), 1)) + "}\\u0041`;"],
    `}`,
    `print("${tag} " + ${use}(${g.int32(0)}) + " " + ${use}(${g.int32(0)}) + " " + ${tag}\`a\${1}\\n\${2}\\u0041\`);`,
    `print("${seen} " + (${seen}[0] === ${seen}[1]) + " " + (${seen}[0] === ${seen}[2]) + " " + Object.isFrozen(${seen}[0]) + " " + Object.isFrozen(${seen}[0].raw) + " " + ${seen}[0].length + " " + Array.isArray(${seen}[0]));`,
  );
  if (random.chance(0.5)) g.emit(...g.attempt([`"${seen} store " + (${g.cast(`${seen}[0]`)}[0] = "changed")`, `"${seen} after " + ${use}(3)`]));
  g.declare(use, { is: "function", parameters: [int32], result: string });
}

function argumentsObjects(g: Generator): void {
  const { random } = g;
  const rest = `..._${g.annotation("any[]")}`;
  const pieces: (() => Code[])[] = [
    () => {
      const name = g.fresh("count");
      return [
        `function ${name}(${rest})${g.annotation("string")} {`,
        [`return arguments.length + ":" + Array.prototype.join.call(arguments, "-") + ":" + typeof arguments + ":" + Object.prototype.toString.call(arguments);`],
        `}`,
        `print("${name} " + ${name}() + " " + ${name}(${g.int32(0)}, ${g.string(0)}) + " " + ${name}(undefined) + " " + ${name}(...[1, 2, 3]));`,
      ];
    },
    () => {
      const name = g.fresh("change");
      return [
        `function ${name}(a${g.annotation("number")}, b${g.annotation("number")} = 5)${g.annotation("string")} {`.replace(random.chance(0.5) ? " = 5" : "\0", ""),
        [`arguments[0] = ${g.int32(0)};`, `a += 1;`, `arguments.length = 1;`, `return a + ":" + arguments[0] + ":" + arguments[1] + ":" + arguments.length + ":" + b;`],
        `}`,
        `print("${name} " + ${name}(${g.int32(0)}, ${g.int32(0)}) + " " + ${g.cast(name)}(${g.int32(0)}));`,
      ];
    },
    () => {
      const [name, kept] = [g.fresh("leak"), g.fresh("kept")];
      return [
        `function ${name}(${rest})${g.annotation("IArguments")} {`,
        [`return arguments;`],
        `}`,
        `const ${kept} = ${name}(${g.int32(0)}, ${g.string(0)}, ${g.int32(0)});`,
        `${kept}[1] = ${g.int32(0)};`,
        `print("${kept} " + ${kept}.length + " " + [...${kept}].join() + " " + ${g.keysOf(kept)} + " " + Array.from(${name}()).length + " " + (${name}(1) === ${name}(1)) + " " + Array.isArray(${kept}));`,
      ];
    },
    () => {
      const name = g.fresh("inner");
      return [
        `function ${name}(${rest})${g.annotation("number")} {`,
        [`const total = () => {`, [`let sum = 0;`, `for (let i = 0; i < arguments.length; i++) sum += arguments[i];`, `return sum;`], `};`, `return total();`],
        `}`,
        `print("${name} " + ${name}(${g.int32(0)}, ${g.number(0)}, ${g.int32(0)}) + " " + ${name}());`,
      ];
    },
  ];
  g.emitSome(pieces, random.between(1, 2));
}

function parameters(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const pieces: (() => Code[])[] = [
    () => {
      const name = g.fresh("defaults");
      return [
        `function ${name}(a${a("number")}, b${a("number")} = a + ${g.int32(0)}, c${a("() => number")} = () => a + b, d${a("number")} = c()) {`,
        [`a = ${g.int32(0)};`, `return [a, b, c(), d].join();`],
        `}`,
        `print("${name} " + ${name}(${g.int32(0)}) + " " + ${name}(${g.int32(0)}, undefined, undefined, ${g.int32(0)}) + " " + ${name}(1, 2, () => 3) + " " + ${name}.length + " " + ${name}.name);`,
      ];
    },
    () => {
      const name = g.fresh("rest");
      g.declare(name, { is: "function", parameters: [int32, int32, int32], result: string });
      return [
        `function ${name}(first${a("number")}, ...others${a("number[]")})${a("string")} {`,
        [`others.push(first);`, `return first + ":" + others.length + ":" + others.join() + ":" + Array.isArray(others);`],
        `}`,
        `print("${name} " + ${name}(${g.int32(0)}) + " " + ${name}(${g.int32(0)}, ${g.int32(0)}, ${g.number(0)}) + " " + ${name}(...${g.cast(g.cast(g.array(int32, 1), "number[]"), "[number, ...number[]]")}) + " " + ${name}.length);`,
      ];
    },
    () => {
      const name = g.fresh("loose");
      const kind = g.someKind(true);
      return [
        `function ${name}(a${a(g.typeText(kind))}, b${g.typed ? "?" : ""}${a(g.typeText(kind))})${a("string")} {`,
        [`return typeof a + ":" + typeof b + ":" + String(b === undefined ? a : b);`],
        `}`,
        `print("${name} " + ${name}(${g.expression(kind, 1)}) + " " + ${name}(${g.expression(kind, 1)}, ${g.expression(kind, 1)}) + " " + ${g.cast(name)}(${g.expression(kind, 0)}, ${g.expression(kind, 0)}, ${g.int32(0)}, ${g.string(0)}) + " " + ${g.cast(name)}());`,
      ];
    },
    () => {
      const [name, calls] = [g.fresh("lazy"), g.fresh("calls")];
      return [
        `let ${calls} = 0;`,
        `function ${name}(value${a("number")} = ++${calls})${a("number")} {`,
        [`return value;`],
        `}`,
        `print("${name} " + ${name}() + " " + ${name}(${g.int32(0)}) + " " + ${name}(undefined) + " " + ${name}() + " " + ${calls});`,
      ];
    },
  ];
  g.emitSome(pieces, random.between(1, 2));
}

function objectFunctions(g: Generator): void {
  const { random } = g;
  const holder = g.variable(kind => fieldsOf(kind).length > 0);
  const text = (value: string) => `String(${value})`;
  const pieces: (() => Code[] | undefined)[] = [
    () => holder && [`print("${g.fresh("entries")} " + Object.entries(${holder.name}).map(([key, value]) => key + "=" + ${text("value")}).join("&") + " " + Object.values(${holder.name}).length + " " + Object.getOwnPropertyNames(${holder.name}).join());`],
    () => holder && [`print("${g.fresh("turned")} " + Object.keys(Object.fromEntries(Object.entries(${holder.name}).reverse())).join() + " " + Object.keys(Object.assign({}, ${holder.name}, { zz: 1 })).join());`],
    () => {
      if (!holder) return undefined;
      const field = random.pick(fieldsOf(holder.kind));
      return [`print("${g.fresh("descriptor")} " + JSON.stringify(Object.getOwnPropertyDescriptor(${holder.name}, ${g.computedKey(field.name)}), (key, value) => (typeof value === "bigint" ? "big" : value)) + " " + Object.getOwnPropertyDescriptor(${holder.name}, "nothing"));`];
    },
    () => {
      const name = g.fresh("ordered");
      const keys = random.shuffled(["b", "2", "a", "1", '"-1"', '"01"', "10", '"1.5"', "c"]).slice(0, 6);
      return [
        `const ${name}${g.annotation("Record<string, number>")} = { ${keys.map((key, i) => `${key}: ${i}`).join(", ")} };`,
        `${name}[${g.computedKey(random.pick(["0", "z", "3", "00"]))}] = 9;`,
        `delete ${name}[${g.computedKey(keys[0].replaceAll('"', ""))}];`,
        `${name}[${JSON.stringify(keys[0].replaceAll('"', ""))}] = 8;`,
        `print("${name} " + ${g.keysOf(name)} + " " + JSON.stringify(${name}) + " " + Object.values(${name}).join());`,
        `for (const key in ${name}) mix(key.length + ${name}[key]);`,
      ];
    },
    () => {
      const [base, name] = [g.fresh("base"), g.fresh("derived")];
      return [
        `const ${base} = { shared: ${g.int32(0)}, describe() { return "base " + this.shared; } };`,
        `const ${name} = ${random.pick([`Object.create(${base}, { own: { value: ${g.int32(0)}, enumerable: ${random.chance(0.5)}, writable: true } })`, `{ __proto__: ${base}, own: ${g.int32(0)} }`, `Object.setPrototypeOf({ own: ${g.int32(0)} }, ${base})`])}${g.typed ? ` as unknown as { own: number; shared: number; describe(): string }` : ""};`,
        `${name}.shared++;`,
        `const ${name}Keys${g.annotation("string[]")} = [];`,
        `for (const key in ${name}) ${name}Keys.push(key);`,
        `print("${name} " + ${name}.describe() + " " + ${base}.shared + " " + ${g.keysOf(name)} + " " + ${name}Keys.join() + " " + Object.hasOwn(${name}, "shared") + " " + ${base}.isPrototypeOf(${name}));`,
      ];
    },
    () => {
      const name = g.fresh("hidden");
      return [
        `const ${name}${g.annotation("Record<string, number>")} = { seen: 1 };`,
        `Object.defineProperty(${name}, "quiet", { value: ${g.int32(0)}, enumerable: false, writable: ${random.chance(0.5)}, configurable: ${random.chance(0.5)} });`,
        ...g.attempt([`"${name} store " + (${name}.quiet = 5)`, `"${name} delete " + delete ${name}.quiet`]),
        `print("${name} " + ${name}.quiet + " " + ${g.keysOf(name)} + " " + JSON.stringify(${name}) + " " + ("quiet" in ${name}) + " " + Object.getOwnPropertyNames(${name}).join() + " " + JSON.stringify({ ...${name} }));`,
      ];
    },
  ];
  g.need("mix");
  g.emitSome(pieces, 2);
}

/** A proxy that forwards and keeps a trace stands among the plain objects in scope. */
function proxies(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const trace = g.fresh("trace");
  g.emit(`const ${trace}${a("string[]")} = [];`);
  const traps: Code[] = [];
  const all: [string, string, string][] = [
    ["get", `target, key, receiver`, random.pick([`Reflect.get(target, key, receiver)`, `${g.cast("target")}[key]`])],
    ["set", `target, key, value, receiver`, random.pick([`Reflect.set(target, key, value, receiver)`, `((${g.cast("target")}[key] = value), true)`])],
    ["has", `target, key`, random.pick([`Reflect.has(target, key)`, `key in target`])],
    ["deleteProperty", `target, key`, random.pick([`Reflect.deleteProperty(target, key)`, `delete ${g.cast("target")}[key]`])],
    ["ownKeys", `target`, `Reflect.ownKeys(target)`],
    ["getOwnPropertyDescriptor", `target, key`, `Reflect.getOwnPropertyDescriptor(target, key)`],
    ["defineProperty", `target, key, descriptor`, `Reflect.defineProperty(target, key, descriptor)`],
    ["getPrototypeOf", `target`, `Reflect.getPrototypeOf(target)`],
  ];
  for (const [name, list, forward] of random.sample(all, random.between(1, 5))) {
    traps.push(`${name}(${list}) {`, [`${trace}.push("${name}"${list.includes("key") ? ` + ":" + String(key)` : ""});`, `return ${forward};`], `},`);
  }
  const holder = g.variable(kind => fieldsOf(kind).length > 0);
  const name = g.fresh("proxy");
  if (holder && random.chance(0.8)) {
    g.emit(`const ${name}${a(g.typeText(holder.kind))} = new Proxy(${holder.name}, {`, traps, `});`);
    const variable = g.declare(name, holder.kind);
    g.emit(...g.lookCarefully(variable));
  } else if (random.chance(0.5)) {
    const target = g.fresh("target");
    g.emit(
      `function ${target}(value${a("number")})${a("number")} {`,
      [`return (value + ${g.int32(0)}) | 0;`],
      `}`,
      `const ${name} = new Proxy(${target}, {`,
      [`apply(callee, receiver, list) {`, [`${trace}.push("apply:" + list.length);`, `return ${random.pick([`Reflect.apply(callee, receiver, list)`, `callee.apply(receiver, ${g.cast("list", "[number]")})`])} + 1;`], `},`, `construct(callee, list) {`, [`${trace}.push("construct");`, `return { made: list.length };`], `},`],
      `});`,
      `print("${name} " + ${name}(${g.int32(0)}) + " " + ${name}.call(null, ${g.int32(0)}) + " " + JSON.stringify(new ${g.cast(name)}(1, 2)) + " " + typeof ${name});`,
    );
    g.declare(name, { is: "function", parameters: [int32], result: int32 });
  } else {
    const handle = g.fresh("revocable");
    g.emit(
      `const ${handle} = Proxy.revocable${g.typeArguments("Record<string, number>")}({ inside: ${g.int32(0)} }, {`,
      traps,
      `});`,
      `print("${handle} " + ${handle}.proxy.inside);`,
      `${handle}.revoke();`,
      ...g.attempt([`"${handle} revoked " + ${handle}.proxy.inside`, `"${handle} typeof " + typeof ${handle}.proxy`]),
    );
  }
  g.emit(`print("${trace} " + ${trace}.length + " " + ${trace}.slice(0, 24).join());`);
}

function json(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const big = `(key${a("string")}, value${a("unknown")}) => (typeof value === "bigint" ? "big" : value)`;
  const holder = g.variable(kind => fieldsOf(kind).length > 0);
  const pieces: (() => Code[] | undefined)[] = [
    () => [`print("${g.fresh("odd")} " + JSON.stringify([NaN, -0, Infinity, undefined, () => 1, Symbol("s"), null, ${g.number(0)}, , "\\u2028\\ud800"]) + " " + JSON.stringify({ a: undefined, b: () => 1, c: Symbol("s"), d: ${g.number(0)} }) + " " + JSON.stringify(undefined) + " " + JSON.stringify(${g.string(0)}));`],
    () => holder && [`print("${g.fresh("text")} " + JSON.stringify(${holder.name}, ${big}, ${random.pick(["0", "1", '"-"'])}).replaceAll("\\n", "~"));`],
    () => {
      if (!holder) return undefined;
      const names = fieldsOf(holder.kind)
        .filter(field => field.kind.is !== "bigint")
        .map(field => field.name);
      if (names.length === 0) return undefined;
      return [`print("${g.fresh("listed")} " + JSON.stringify({ ...${holder.name}, ${names[0]}: 1 }, [${random.shuffled([...names, "nothing"]).slice(0, 3).map(name => `"${name}"`).join(", ")}]));`];
    },
    () => {
      const name = g.fresh("Custom");
      return [
        `class ${name} {`,
        [`inner = ${g.int32(0)};`, `toJSON(key${a("string")}) {`, [`return { key, inner: this.inner, nested: key === "" ? new ${name}() : null };`], `}`],
        `}`,
        `print("${name} " + JSON.stringify(new ${name}()) + " " + JSON.stringify({ held: new ${name}() }) + " " + JSON.stringify([new ${name}()]));`,
      ];
    },
    () => {
      const visits = g.fresh("visits");
      return [
        `const ${visits}${a("string[]")} = [];`,
        `const ${visits}Result = JSON.parse('{"b":[1,{"c":2}],"a":-0,"2":"two","1":1e3,"__proto__":{"x":1}}', function (${g.typed ? "this: any, " : ""}key${a("string")}, value${a("any")}) {`,
        [`${visits}.push(key + ":" + typeof value);`, `return typeof value === "number" ? value ${random.pick(["+ 1", "* 2", "| 0"])} : ${random.chance(0.3) ? `key === "c" ? undefined : value` : "value"};`],
        `});`,
        `print("${visits} " + ${visits}.join() + " " + JSON.stringify(${visits}Result) + " " + Object.keys(${visits}Result).join() + " " + (Object.getPrototypeOf(${visits}Result) === Object.prototype));`,
      ];
    },
    () => {
      if (!holder || holder.kind.is !== "record" || holder.kind.shape.fields.some(field => field.kind.is === "bigint")) return undefined;
      const back = g.fresh("back");
      const code: Code[] = [`const ${back}${g.annotation(holder.kind)} = JSON.parse(JSON.stringify(${holder.name}));`];
      // NaN, -0 and undefined do not survive, so only a shape of int32, string and boolean fields goes on as a regular variable.
      if (holder.kind.shape.fields.every(field => ["int32", "string", "boolean"].includes(field.kind.is))) code.push(...g.look(g.declare(back, holder.kind)));
      else code.push(`print("${back} " + ${g.keysOf(back)});`);
      return code;
    },
    () => g.attempt([`"${g.fresh("bad")} " + JSON.parse(${random.pick([`"{"`, `""`, `"[1,]"`, `"{'a':1}"`, `"01"`, `"nul"`])})`, `"${g.fresh("big")} " + JSON.stringify({ n: ${g.bigint(0)} })`]),
    () => {
      const ring = g.fresh("ring");
      return [`const ${ring}${a("{ inner?: unknown }")} = {};`, `${ring}.inner = ${ring};`, ...g.attempt([`"${ring} " + JSON.stringify(${ring})`])];
    },
  ];
  g.emitSome(pieces, 3);
}

function typedArrays(g: Generator): void {
  const { random } = g;
  const type = random.pick(["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"]);
  const name = g.fresh("bytes");
  const value = () => random.pick([g.int32(1), g.number(1), "256", "-1", "1.7", "NaN", "2147483648", "-0"]);
  g.emit(`const ${name} = new ${type}(${random.chance(0.5) ? `[${value()}, ${value()}, ${value()}, ${value()}]` : "4"});`);
  const pieces: (() => Code[])[] = [
    () => [`${name}[${random.below(4)}] = ${value()};`],
    () => [`${name}[${random.pick(["4", "9", "-1", "1.5"])}] = ${value()};`],
    () => [`${name}[${random.below(4)}] ${random.pick(["+=", "*=", "-=", "<<=", "/="])} ${value()};`],
    () => [`${name}[${random.below(4)}]${random.pick(["++", "--"])};`],
    () => [`${name}.fill(${value()}, ${random.below(3)});`],
    () => [`${name}.set([${value()}, ${value()}], ${random.below(3)});`],
    () => [`${name}.sort();`],
    () => [`${name}.reverse();`],
    () => [`${name}.subarray(1, 3)[0] = ${value()};`],
    () => [`${name}.copyWithin(0, 2);`],
    () => [`new Uint8Array(${name}.buffer)[${random.below(4)}] = ${random.pick(["255", "128", "1"])};`],
    () => [`new DataView(${name}.buffer).${random.pick(["setInt8(0, -2)", "setUint8(1, 200)"])};`],
  ];
  g.emitSome(pieces, random.between(2, 5));
  g.emit(
    `print("${name} " + ${name}.length + " " + ${name}.join() + " " + ${name}[9] + " " + ${name}[-1] + " " + Object.is(${name}[0], -0) + " " + ${name}.byteLength + " " + ${name}.includes(NaN) + " " + ${name}.indexOf(${value()}));`,
    `print("${name} more " + ${name}.map(item => item * 2).join() + " " + ${name}.slice(-2).join() + " " + ${name}.reduce((sum, item) => sum + item, 0) + " " + Array.from(${name}).length + " " + ${g.keysOf(name)} + " " + (${name}.subarray(1).buffer === ${name}.buffer) + " " + Object.prototype.toString.call(${name}));`,
  );
  const sum = g.fresh("sum");
  g.emit(`let ${sum} = 0;`, `for (let i = 0; i <= ${name}.length; i++) ${sum} = (${sum} + (${name}[i] | 0)) | 0;`, `print("${sum} " + ${sum});`);
  g.declare(sum, int32, true);
  if (random.chance(0.3)) {
    const wide = g.fresh("wide");
    g.emit(`const ${wide} = new BigInt64Array([${g.bigint(0)}, ${g.bigint(0)}]);`, `${wide}[0] += ${g.bigint(0)};`, `print("${wide} " + ${wide}.join() + " " + typeof ${wide}[1] + " " + new BigUint64Array(${wide}.buffer)[0]);`);
  }
}

function stringLoops(g: Generator): void {
  const { random } = g;
  const pieces: (() => Code[])[] = [
    () => {
      const text = g.fresh("text");
      const code: Code[] = [
        `let ${text} = ${g.string(0)};`,
        `for (let i = 0; i < ${random.pick([3, 10, 40])}; i++) ${text} ${random.pick([`+= i`, `+= String.fromCharCode(97 + (i % 26))`, `= i + ${text}`, `+= ${g.string(0)}`, `= ${text} + i + ${text}.length`])};`,
        `print("${text} " + ${text}.length + " " + ${text}.slice(0, 12) + " " + ${text}.slice(-6) + " " + ${text}.charCodeAt(${text}.length) + " " + ${text}.charCodeAt(${random.below(5)}) + " " + ${text}.indexOf("1") + " " + ${text}.lastIndexOf("1"));`,
      ];
      g.declare(text, string, true);
      return code;
    },
    () => {
      const text = g.fresh("pairs");
      return [
        `const ${text} = ${random.pick(['"a\\u{1F600}b"', '"\\u{1F600}\\u{1F601}"', '"\\ud83dx\\ude00"', '"e\\u0301\\u{10FFFF}"'])} + ${g.string(0)};`,
        `print("${text} " + ${text}.length + " " + [...${text}].length + " " + ${text}.codePointAt(1) + " " + ${text}.charCodeAt(1) + " " + ${text}.split("").length + " " + Array.from(${text}, part => part.length).join() + " " + ${text}.at(-1)?.length + " " + ${text}.isWellFormed() + " " + encodeURIComponent(${text}.toWellFormed()).length + " " + ${text}.slice(1, 2).charCodeAt(0));`,
      ];
    },
    () => {
      const [holder, list] = [g.fresh("byText"), g.fresh("cells")];
      return [
        `const ${holder}${g.annotation("Record<string, string>")} = {};`,
        `const ${list}${g.annotation("string[]")} = ["zero", "one", "two"];`,
        `for (const key of ["1", "01", "1.0", "-0", "0", "1e0", " 1", "2"]) {`,
        [`${holder}[key] = key + "!";`, `${holder}[Number(key)] = "n" + key;`, `mix((${list}[${g.cast("key")}] ?? "").length);`],
        `}`,
        `print("${holder} " + Object.keys(${holder}).join("|") + " " + ${holder}[1] + " " + ${holder}["1"] + " " + ${holder}[-0] + " " + ${list}[${g.cast('"1"')}] + " " + ${list}[${g.cast('"01"')}] + " " + ("1" in ${list}) + " " + ("3" in ${list}));`,
      ];
    },
    () => {
      const text = g.string(1);
      return [
        `print("${g.fresh("pieces")} " + ${text}.split("").reverse().join("") + " " + ${text}.replace(/(.)(.)/g, (whole${g.annotation("string")}, left${g.annotation("string")}, right${g.annotation("string")}, at${g.annotation("number")}) => right + left + at) + " " + ${text}.replaceAll("a", "$&$&") + " " + ${text}.padStart(6, "ab") + " " + ${text}.substring(3, 1) + " " + ${text}.substr(-2, 1) + " " + ${text}.concat("x", "y").length + " " + (${text} < "b") + " " + ${text}.search(/[a-z]/) + " " + JSON.stringify(${text}.match(/(?<first>\\w)(\\w)?/)?.groups ?? null));`,
      ];
    },
  ];
  g.need("mix");
  g.emitSome(pieces, random.between(1, 2));
}

function weakCollections(g: Generator): void {
  const { random } = g;
  const holders = g.variables(kind => fieldsOf(kind).length > 0 || kind.is === "array");
  const [first, second] = [holders[0]?.name ?? "{}", holders[1]?.name ?? "[]"];
  const name = g.fresh("weak");
  const keyA = g.fresh("keyA");
  const keyB = g.fresh("keyB");
  g.emit(`const ${keyA}${g.annotation("object")} = ${first};`, `const ${keyB}${g.annotation("object")} = ${second};`);
  if (random.chance(0.6)) {
    g.emit(
      `const ${name} = new ${random.pick(["WeakMap", "Map"])}${g.typeArguments("object, number")}([[${keyA}, ${g.int32(0)}]]);`,
      `${name}.set(${keyB}, ${g.int32(0)}).set(${keyA}, (${name}.get(${keyA}) ?? 0) + 1);`,
      `print("${name} " + ${name}.get(${keyA}) + " " + ${name}.get(${keyB}) + " " + ${name}.has({}) + " " + ${name}.get({ ...${keyA} }) + " " + ${name}.delete(${keyB}) + " " + ${name}.has(${keyB}) + " " + ${name}.delete(${keyB}));`,
      ...g.attempt([`"${name} primitive " + ${name}.set(${g.cast("1")}, 1)`]).slice(0, random.chance(0.5) ? undefined : 0),
    );
  } else {
    g.emit(
      `const ${name} = new ${random.pick(["WeakSet", "Set"])}${g.typeArguments("object")}([${keyA}, ${keyA}]);`,
      `print("${name} " + ${name}.has(${keyA}) + " " + ${name}.has(${keyB}) + " " + ${name}.add(${keyB}).has(${keyB}) + " " + ${name}.delete(${keyA}) + " " + ${name}.has(${keyA}) + " " + (new WeakRef(${keyB}).deref() === ${keyB}));`,
    );
  }
}

function collectionIteration(g: Generator): void {
  const { random } = g;
  const name = g.fresh("visited");
  const table = g.fresh("live");
  const isMap = random.chance(0.5);
  const put = (key: string) => (isMap ? `${table}.set(${key}, ${g.int32(0)})` : `${table}.add(${key})`);
  const change = random.pick([
    `${table}.delete(key);`,
    `${table}.delete(key + 1);`,
    `if (${table}.size < 8) ${put("key + 10")};`,
    `${table}.delete(key);\n${put("key")};`.split("\n")[0],
    `if (key === 2) ${table}.clear();`,
    `${table}.delete(1); if (key === 2) ${put("1")};`,
  ]);
  g.emit(
    `const ${table} = new ${isMap ? `Map${g.typeArguments("number, number")}([[1, 1], [2, 2], [3, 3], [NaN, 4], [0, 5]])` : `Set${g.typeArguments("number")}([1, 2, 3, NaN, 0])`};`,
    `${put("-0")};`,
    `${put("NaN")};`,
    `const ${name}${g.annotation("string[]")} = [];`,
    ...random.pick<Code[]>([
      [`for (const key of ${table}.keys()) {`, [`${name}.push(String(key));`, change], `}`],
      [`${table}.forEach((value, key) => {`, [`${name}.push(String(key));`, change], `});`],
      [`for (const ${isMap ? "[key]" : "key"} of ${table}) {`, [`${name}.push(String(key));`, change], `}`],
    ]),
    `print("${name} " + ${name}.join() + " " + ${table}.size + " " + ${g.listing(table, isMap ? "[key]" : "key", `(Object.is(key, -0) ? "-0" : String(key))`, false)} + " " + ${table}.has(-0) + " " + ${table}.has(NaN));`,
  );
  g.declare(table, isMap ? { is: "map", key: number, value: int32 } : { is: "set", element: number });
}

const survivesUndefined = (kind: Kind) => ["int32", "number", "boolean", "mixed"].includes(kind.is);

function someFields(g: Generator, count: number, taken: string[] = []): Field[] {
  return g.random.sample(fieldNames.filter(name => !taken.includes(name)), count).map(name => ({ name, kind: g.fieldKinds.get(name)! }));
}

/** `this` gets out of a constructor before the fields are stored, and is read and written from outside. */
function escapingThis(g: Generator): void {
  const { random } = g;
  const [base, derived, escaped, early] = [g.fresh("C"), g.fresh("C"), g.fresh("escaped"), g.fresh("early")];
  const [first] = someFields(g, 1);
  const [second] = someFields(g, 1, [first.name]);
  g.need("log");
  const parent: ClassModel = { name: base, type: base, isFunction: false, fields: [first], methods: [], parameters: [first.kind] };
  const child: ClassModel = { name: derived, type: derived, isFunction: false, parent, fields: [second], methods: [], parameters: [first.kind] };
  const leak = random.pick([`${early}(this);`, `[this].forEach(${early});`, `${early}.call(undefined, this);`, `Reflect.apply(${early}, undefined, [this]);`]);
  const store = `this.${first.name} = a0;`;
  g.emit(
    `let ${escaped}${g.annotation(`${base} | undefined`)};`,
    `function ${early}(o${g.annotation(base)})${g.annotation("void")} {`,
    [
      `${escaped} = o;`,
      `log.push("early " + String(o.${first.name}) + " " + String(${g.cast("o")}.${second.name}) + " [" + Object.keys(o).join() + "]");`,
      ...(random.chance(0.6) ? [`o.${first.name} = ${g.expression(first.kind, 1)};`] : []),
      ...(random.chance(0.6) ? [`${g.cast("o")}.${second.name} = ${g.expression(second.kind, 1)};`] : []),
    ],
    `}`,
    `class ${base} {`,
    [`${first.name}${g.annotation(first.kind)}${random.chance(0.4) ? ` = ${g.expression(first.kind, 0)}` : ""};`, `constructor(a0${g.annotation(first.kind)}) {`, random.chance(0.7) ? [leak, store] : [store, leak], `}`],
    `}`,
    `class ${derived} extends ${base} {`,
    [`${second.name}${g.annotation(second.kind)} = ${g.expression(second.kind, 1)};`],
    `}`,
  );
  g.classes.push(parent, child);
  for (const model of random.chance(0.5) ? [child, parent] : [child]) {
    const name = g.fresh("o");
    g.emit(`const ${name} = new ${model.name}(${g.expression(first.kind, 1)});`);
    const variable = g.declare(name, { is: "instance", of: model });
    g.emit(`print("${name} " + (${escaped} === ${name}) + " " + ${g.keysOf(name)});`, ...g.look(variable));
  }
  g.emit(`flush("${early}");`);
}

/** The constructor of a base class calls a method that an heir overrides, before the heir's fields exist. */
function earlyVirtualCall(g: Generator): void {
  const { random } = g;
  const [base, derived] = [g.fresh("C"), g.fresh("C")];
  const [field] = someFields(g, 1);
  g.need("log");
  const parent: ClassModel = { name: base, type: base, isFunction: false, fields: [], methods: [], parameters: [] };
  const child: ClassModel = { name: derived, type: derived, isFunction: false, parent, fields: [field], methods: [], parameters: [] };
  g.emit(
    `class ${base} {`,
    [`constructor() {`, [`this.setup();`], `}`, `setup()${g.annotation("void")} {`, [`log.push("${base} setup");`], `}`],
    `}`,
    `class ${derived} extends ${base} {`,
    [
      `${field.name}${g.annotation(field.kind)}${random.chance(0.7) || !survivesUndefined(field.kind) ? ` = ${g.expression(field.kind, 1)}` : g.typed ? ` = ${g.cast("undefined")}` : ""};`,
      `setup()${g.annotation("void")} {`,
      [`log.push("sees " + String(this.${field.name}) + " " + Object.keys(this).length);`, `this.${field.name} = ${g.expression(field.kind, 1)};`, ...(random.chance(0.5) ? [`super.setup();`] : [])],
      `}`,
    ],
    `}`,
  );
  g.classes.push(parent, child);
  const name = g.fresh("o");
  g.emit(`const ${name} = new ${derived}();`, ...g.look(g.declare(name, { is: "instance", of: child })), `${name}.setup();`, `flush("${derived}");`);
}

function constructorReturnsOther(g: Generator): void {
  const { random } = g;
  const [base, derived, other] = [g.fresh("C"), g.fresh("C"), g.fresh("other")];
  const [first] = someFields(g, 1);
  const [second] = someFields(g, 1, [first.name]);
  g.emit(
    `const ${other}${g.annotation("Record<string, unknown>")} = { original: true };`,
    `class ${base} {`,
    [`${first.name}${g.annotation(first.kind)} = ${g.expression(first.kind, 1)};`, `constructor(swap${g.annotation("boolean")}) {`, [`if (swap) return ${g.cast(other)};`], `}`],
    `}`,
    `class ${derived} extends ${base} {`,
    [`${second.name}${g.annotation(second.kind)} = ${g.expression(second.kind, 1)};`, `#mark = 1;`, `static marked(o${g.annotation("object")})${g.annotation("boolean")} {`, [`return #mark in o;`], `}`],
    `}`,
    `const ${other}A = new ${base}(true);`,
    `const ${other}B = new ${base}(false);`,
    `print("${other} " + (${g.cast(`${other}A`, "unknown")} === ${other}) + " " + (${g.cast(`${other}B`, "unknown")} === ${other}) + " " + (${other}A instanceof ${base}) + " " + ${g.keysOf(other)} + " " + Object.keys(${other}B).join());`,
    `const ${other}C = new ${derived}(true);`,
    `print("${other} heir " + (${g.cast(`${other}C`, "unknown")} === ${other}) + " " + ${g.keysOf(other)} + " " + ${derived}.marked(${other}) + " " + ${derived}.marked(${other}B) + " " + (${other}C instanceof ${derived}) + " " + String(${other}C.${second.name}));`,
    ...g.attempt([`"${other} twice " + Object.keys(new ${derived}(true)).join()`, `"${other} plain " + Object.keys(new ${derived}(false)).join()`]),
  );
  if (random.chance(0.5)) g.emit(`print("${other} construct " + (Reflect.construct(${base}, [false], ${derived}) instanceof ${derived}) + " " + Object.keys(Reflect.construct(${base}, [false], ${derived})).join());`);
}

/** A constructor throws between two stores, and the object it was building is used afterwards. */
function halfBuilt(g: Generator): void {
  const { random } = g;
  const [name, half] = [g.fresh("C"), g.fresh("half")];
  const fields = someFields(g, 2);
  const model: ClassModel = { name, type: name, isFunction: false, fields, methods: [], parameters: [int32, ...fields.map(field => field.kind)] };
  g.need("errorName");
  const thrower = random.pick([`throw new Error("own half");`, `${g.cast("undefined")}.missing;`, `${g.cast("null")}();`, `new Array(-1);`, `BigInt(0.5);`]);
  g.emit(
    `const ${half}${g.annotation(`${name}[]`)} = [];`,
    `class ${name} {`,
    [
      ...fields.map(field => `${field.name}${g.annotation(field.kind)};`),
      `constructor(when${g.annotation("number")}, ${fields.map((field, i) => `a${i}${g.annotation(field.kind)}`).join(", ")}) {`,
      [`${half}.push(this);`, `this.${fields[0].name} = a0;`, `if (when > 1) ${thrower}`, `this.${fields[1].name} = a1;`],
      `}`,
    ],
    `}`,
    `for (let when = 0; when < 4; when++) {`,
    [`try {`, [`new ${name}(when, ${g.expression(fields[0].kind, 1)}, ${g.expression(fields[1].kind, 1)});`], `} catch (error) {`, [`print("${half} " + when + " " + errorName(error));`], `}`],
    `}`,
    `print("${half} " + ${half}.length + " " + ${g.listing(half, "o", `Object.keys(o).join("+") + ":" + String(o.${fields[0].name}) + ":" + String(o.${fields[1].name})`)});`,
  );
  const whole = g.fresh("o");
  g.emit(`const ${whole} = ${half}[${random.below(2)}];`);
  g.declare(whole, { is: "instance", of: model });
}

function newTargets(g: Generator): void {
  const { random } = g;
  const [both, base, derived] = [g.fresh("Both"), g.fresh("C"), g.fresh("C")];
  g.emit(
    `function ${both}(${g.typed ? "this: unknown" : ""})${g.annotation("string | void")} {`,
    [`if (new.target === undefined) return "called";`, `${g.cast("this")}.how = new.target === ${both} ? "constructed" : "inherited";`],
    `}`,
    `class ${base} {`,
    [`made${g.annotation("string")};`, `constructor() {`, [`this.made = new.target.name + (new.target === ${base});`], `}`],
    `}`,
    `class ${derived} extends ${base} {}`,
    `print("${both} " + ${both}() + " " + new ${g.cast(both)}().how + " " + Reflect.construct(${both}, [], ${base}).how + " " + ${both}.call({}) + " " + new ${base}().made + " " + new ${derived}().made + " " + Reflect.construct(${base}, [], ${derived}).made + " " + (Reflect.construct(${base}, [], ${derived}) instanceof ${derived}) + " " + (Reflect.construct(${base}, [], ${both}) instanceof ${base}));`,
  );
  if (random.chance(0.5)) g.emit(...g.attempt([`"${base} called " + ${g.cast(base)}()`, `"${base} arrow " + new ${g.cast("(() => 1)")}()`]));
}

function privateMembers(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const name = g.fresh("C");
  g.emit(
    `class ${name} {`,
    [
      `#value${a("number")};`,
      `static #count = 0;`,
      `constructor(value${a("number")}) {`,
      [`this.#value = value;`, `${name}.#count++;`],
      `}`,
      `#double()${a("number")} {`,
      [`return (this.#value * 2) | 0;`],
      `}`,
      `get #half()${a("number")} {`,
      [`return this.#value / 2;`],
      `}`,
      `set #half(value${a("number")}) {`,
      [`this.#value = value * 2;`],
      `}`,
      `total()${a("number")} {`,
      [`this.#half = this.#half + ${g.int32(0)};`, `return this.#double() + this.#half;`],
      `}`,
      `same(other${a(name)})${a("boolean")} {`,
      [`return this.#value === other.#value;`],
      `}`,
      `static has(o${a("object")})${a("boolean")} {`,
      [`return #value in o;`],
      `}`,
      `static count()${a("number")} {`,
      [`return ${name}.#count;`],
      `}`,
    ],
    `}`,
  );
  const model: ClassModel = { name, type: name, isFunction: false, fields: [], methods: [{ name: "total", parameters: [], result: number }], parameters: [int32] };
  g.classes.push(model);
  const [first, second] = [g.fresh("o"), g.fresh("o")];
  g.emit(
    `const ${first} = new ${name}(${g.int32(1)});`,
    `const ${second} = new ${name}(${g.int32(1)});`,
    `print("${first} " + ${first}.total() + " " + ${first}.total() + " " + ${first}.same(${second}) + " " + ${first}.same(${first}) + " " + ${name}.has(${first}) + " " + ${name}.has({}) + " " + ${name}.count() + " " + Object.keys(${first}).length + " " + JSON.stringify(${first}));`,
    ...g.attempt([`"${first} foreign " + ${first}.same(${g.cast("{}")})`, `"${first} borrowed " + ${name}.prototype.total.call(${g.cast(random.pick(["{}", `Object.create(${first})`, `new Proxy(${first}, {})`]))})`]),
  );
  g.declare(first, { is: "instance", of: model });
}

/** What `super` finds changes when a prototype link is changed. */
function superChanges(g: Generator): void {
  const { random } = g;
  const [one, two, heir, name] = [g.fresh("C"), g.fresh("C"), g.fresh("C"), g.fresh("o")];
  g.emit(
    `class ${one} {`,
    [`from = "${one}";`, `who()${g.annotation("string")} {`, [`return "${one}";`], `}`, `static make()${g.annotation("string")} {`, [`return "static ${one}";`], `}`],
    `}`,
    `class ${two} {`,
    [`from = "${two}";`, `who()${g.annotation("string")} {`, [`return "${two}";`], `}`, `static make()${g.annotation("string")} {`, [`return "static ${two}";`], `}`],
    `}`,
    `class ${heir} extends ${one} {`,
    [`who()${g.annotation("string")} {`, [`return "${heir}>" + super.who();`], `}`, `static make()${g.annotation("string")} {`, [`return "heir " + super.make();`], `}`],
    `}`,
    `const ${name} = new ${heir}();`,
    `print("${name} " + ${name}.who() + " " + ${heir}.make() + " " + ${name}.from);`,
    ...g.indirectly(random.sample([`Object.setPrototypeOf(${heir}.prototype, ${two}.prototype);`, `Object.setPrototypeOf(${heir}, ${two});`], random.between(1, 2))),
    `print("${name} " + ${name}.who() + " " + ${heir}.make() + " " + new ${heir}().from + " " + new ${heir}().who() + " " + (${name} instanceof ${one}) + " " + (${name} instanceof ${two}));`,
  );
  if (random.chance(0.5)) {
    const literal = g.fresh("literal");
    g.emit(
      `const ${literal} = { __proto__: { who() { return "first"; } }, who() { return "own>" + super.who(); } };`,
      `print("${literal} " + ${literal}.who());`,
      ...g.indirectly([`Object.setPrototypeOf(${literal}, { who() { return "second"; } });`]),
      `print("${literal} " + ${literal}.who() + " " + ${literal}.who.call({}));`,
    );
  }
}

/** A function with one call in the text runs again, also while its first run is still going on. */
function runsAgain(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [setup, saved, made, again] = [g.fresh("setup"), g.fresh("saved"), g.fresh("made"), g.fresh("again")];
  const site = random.pick([`{ depth }`, `class {}`, `() => depth`, `Symbol("site")`, `[depth]`, `function () {}`]);
  g.emit(
    `const ${saved}${a("(() => number)[]")} = [];`,
    `const ${made}${a("unknown[]")} = [];`,
    `let ${again}${a("(depth: number) => number")} = depth => depth;`,
    `function ${setup}(depth${a("number")})${a("number")} {`,
    [
      `let local = depth * 10;`,
      `const bump = () => ++local;`,
      `${saved}.push(bump);`,
      `${made}.push(${site});`,
      `if (depth > 0) local += ${again}(depth - 1);`,
      `return bump();`,
    ],
    `}`,
    ...g.indirectly([`${again} = ${random.pick([setup, `depth => ${g.callFunction(setup, "depth")}`, `${setup}.bind(undefined)`, `[${setup}][0]`, `new Proxy(${setup}, {})`])};`]),
    `print("${setup} " + ${setup}(${random.between(1, 2)}));`,
    `print("${saved} " + ${g.listing(saved, "bump", "bump()")} + " " + ${g.listing(saved, "bump", "bump()")} + " " + (${made}[0] === ${made}[1]) + " " + new Set(${made}).size);`,
  );
  if (random.chance(0.4)) g.emit(random.pick([`await Promise.resolve().then(() => ${again}(0));`, `await (async () => ${again}(0))();`]), `print("${saved} later " + ${saved}.length + " " + ${g.listing(saved, "bump", "bump()")});`);
}

/** An object that looks local to a function gets out through a side door, and is changed from outside. */
function localEscapes(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [local, leaked] = [g.fresh("local"), g.fresh("leaked")];
  const door = random.pick<Code[]>([
    [`mix(+{ valueOf: () => {`, [`${leaked} = point;`, `return 1;`], `} });`],
    [`[point].forEach(item => {`, [`${leaked} = item;`], `});`],
    [`${leaked} = Object.assign(point);`],
    [`${leaked} = (() => point)();`],
    [`try {`, [`throw point;`], `} catch (error) {`, [`${leaked} = error;`], `}`],
    [`${leaked} = [point][0];`],
    [`${leaked} = { held: point }.held;`],
    [`${leaked} = Object.values({ held: point })[0];`],
    [`${leaked} = new Map([[1, point]]).get(1);`],
    [`[${leaked}] = [point];`],
    [`${leaked} = (function (..._${a("unknown[]")}) {`, [`return arguments[0];`], `})(point);`],
    [`${leaked} = (function* () {`, [`yield point;`], `})().next().value;`],
    [`${leaked} = Reflect.apply((item${a("unknown")}) => item, null, [point]);`],
    [`JSON.stringify(point, function (key, value) {`, [`if (key === "") ${leaked} = value;`, `return value;`], `});`],
    [`${leaked} = new Proxy(point, {});`],
    [`${leaked} = point.me();`],
    [`${leaked} = Array.of(point).pop();`],
    [`${leaked} = new Set([point]).values().next().value;`],
    [`({ held: ${leaked} } = { held: point });`],
    [`${leaked} = Object.freeze([point])[0];`],
  ]);
  const change = random.sample([`${leaked}.x = ${random.pick(["99", '"text"', "0.5", "undefined"])};`, `${leaked}.extra = 1;`, `delete ${leaked}.y;`, `${leaked}.y++;`, `Object.defineProperty(${leaked}, "x", { get: () => 7, set() {}, configurable: true });`], random.between(1, 2));
  g.need("mix");
  g.emit(
    `let ${leaked}${a("any")};`,
    `function ${local}(k${a("number")})${a("string")} {`,
    [`const point = { x: k${g.typed ? " as any" : ""}, y: ${g.int32(0)}, me() { return this; } };`, ...door, ...change, `return point.x + "," + point.y + "," + Object.keys(point).join("+");`],
    `}`,
    `print("${local} " + ${local}(${g.int32(0)}) + " " + ${local}(${g.int32(0)}) + " " + typeof ${leaked});`,
  );
}

/** Arithmetic that starts inside the int32 range and leaves it, or meets -0. */
function ranges(g: Generator): void {
  const { random } = g;
  const name = g.fresh("edge");
  const tell = (value: string) => `${value} + "/" + 1 / ${value}`;
  const pieces: (() => Code[])[] = [
    () => {
      const start = random.pick(["2147483640", "-2147483640", "1073741820", "4294967290", "0", "65530"]);
      const step = random.pick([`${name} += 1;`, `${name}++;`, `${name} -= 3;`, `${name}--;`, `${name} += i;`, `${name} *= 2;`, `${name} = ${name} + ${name};`, `${name} = -${name};`, `${name} = ${name} * -1;`, `${name} -= i * 1000000000;`]);
      g.declare(name, number, true);
      return [`let ${name} = ${start};`, `for (let i = 0; i < ${random.pick([3, 10, 12, 33])}; i++) ${step}`, `print("${name} " + ${tell(name)} + " " + (${name} | 0) + " " + (${name} >>> 0));`];
    },
    () => {
      const count = g.fresh("count");
      return [`let ${count} = 0;`, `for (let i = ${random.pick(["2147483645", "-2147483648", "2147483646"])}; i ${random.pick(["< 2147483650", "<= 2147483647", "!== 2147483649"])} && ${count} < 9; i++) ${count}++;`, `print("${count} " + ${count});`];
    },
    () => {
      const f = g.fresh("negate");
      return [
        `function ${f}(a${g.annotation("number")}, b${g.annotation("number")})${g.annotation("string")} {`,
        [`const results = [-a, a * b, a % b, a / b, Math.abs(a), (a / b) | 0, Math.round(a / 4), Math.max(a * 0, b * 0), a - b, a + b, Math.imul(a, b), a << b, a >>> b];`, `return ${g.listing("results", "value", `(Object.is(value, -0) ? "-0" : String(value))`)};`],
        `}`,
        `print("${f} " + ${f}(${random.pick(["0", "-2147483648", "2147483647", "-4", "7"])}, ${random.pick(["-1", "0", "2", "-2147483648", "31"])}) + " " + ${f}(${g.int32(0)}, ${g.int32(0)}));`,
      ];
    },
    () => {
      const list = g.fresh("cells");
      return [
        `const ${list} = [10, 20, 30];`,
        `let ${list}Sum = 0;`,
        `for (let i = ${random.pick(["-1", "0", "2147483646"])}, turns = 0; turns < 5; i++, turns++) ${list}Sum += ${list}[i] ?? ${list}[i - 2147483646] ?? -1;`,
        `print("${list} " + ${list}Sum + " " + ${list}[${list}.length - 4] + " " + ${list}[2 ** 32] + " " + ${list}[-0] + " " + ${list}[0.5 + 0.5] + " " + ${list}[1.5]);`,
      ];
    },
    () => {
      const halves = g.fresh("halves");
      return [`let ${halves} = ${random.pick(["64", "100", "2147483647", "-7"])};`, `const ${halves}Seen${g.annotation("number[]")} = [];`, `for (let i = 0; i < 8; i++) ${halves}Seen.push((${halves} ${random.pick(["/= 2", "= " + halves + " / 2", "%= 5 - i", ">>= 1", "*= 0.5"])}));`, `print("${halves} " + ${halves}Seen.join());`];
    },
  ];
  g.emitSome(pieces, random.between(1, 3));
}

const throwingExpressions = (g: Generator): string[] => [
  `${g.cast("undefined")}.missing`,
  `${g.cast("null")}[${g.string(0)}]`,
  `${g.cast(g.int32(0))}()`,
  `${g.cast("({})")}.missing()`,
  `new ${g.cast(g.int32(0))}()`,
  `new Array(-1)`,
  `new Array(${g.number(0)}).length`,
  `"x".repeat(-1)`,
  `(1).toFixed(101)`,
  `(1).toString(1)`,
  `BigInt(0.5)`,
  `BigInt("x")`,
  `${g.cast("1n")} + 1`,
  `1n / 0n`,
  `2n ** -1n`,
  `+${g.cast("1n")}`,
  `${g.cast("Symbol()")} + ""`,
  "`${" + g.cast("Symbol()") + "}`",
  `+${g.cast("Symbol()")}`,
  `[...${g.cast(g.int32(0))}]`,
  `(([a]${g.annotation("any")}) => a)(null)`,
  `(({ a }${g.annotation("any")}) => a)(undefined)`,
  `"a" in ${g.cast('"text"')}`,
  `({}) instanceof ${g.cast("{}")}`,
  `({}) instanceof ${g.cast("(() => 1)")}`,
  `Object.defineProperty(Object.freeze({}), "a", { value: 1 })`,
  `Object.setPrototypeOf(Object.preventExtensions({}), {})`,
  `Reflect.ownKeys(${g.cast("1")})`,
  `new Proxy({}, ${g.cast("null")})`,
  `Object.keys(new Proxy({}, { ownKeys: () => ${g.cast("[1]")} }))`,
  `new (class extends ${g.cast("null")} {})()`,
  `new (class extends Object { constructor(skip${g.annotation("boolean")}) { if (!skip) super(); } })(true)`,
  `new (class extends Object { constructor() { super(); super(); } })()`,
  `decodeURIComponent("%")`,
  `new RegExp("(")`,
  `"a".normalize("x")`,
  `String.fromCodePoint(-1)`,
  `new Uint8Array(-1)`,
  `new Uint8Array(new ArrayBuffer(4), 5)`,
  `new Int32Array(new ArrayBuffer(3))`,
  `new DataView(new ArrayBuffer(1)).getInt32(0)`,
  `[].reduce((a, b) => a)`,
  `new Map([${g.cast("1")}])`,
  `new WeakSet([${g.cast("1")}])`,
  `Map.prototype.get.call(${g.cast("{}")}, 1)`,
  `${g.cast("Promise.resolve")}.call(1)`,
  `structuredCloneMissing()`,
  `Object.fromEntries([${g.cast("1")}])`,
  `${g.cast("[]")}.at.call(null)`,
  `Array.from({ length: -1 }).length + Array.from({ length: 2 ** 53 }).length`,
  `new Intl.NumberFormat("xx-invalid-locale-zz")`,
];

function engineErrors(g: Generator): void {
  const { random } = g;
  const all = throwingExpressions(g).filter(expression => !expression.includes("Missing()") && !expression.includes("Intl"));
  const label = g.fresh("throws");
  g.emit(...g.attempt(random.sample(all, random.between(3, 6)).map((expression, i) => `"${label}${i} " + String(${expression})`)));
}

/** Stores before and after something that throws: what was stored before the throw has to be there afterwards. */
function partialUpdates(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [state, step, risky] = [g.fresh("state"), g.fresh("step"), g.fresh("risky")];
  const all = throwingExpressions(g).filter(expression => !expression.includes("Missing()") && !expression.includes("Intl"));
  g.need("errorName");
  g.emit(
    `const ${state} = { a: 0, b: 0, c: 0 };`,
    `function ${risky}(k${a("number")})${a("number")} {`,
    [`if (k === ${random.below(4)}) ${random.chance(0.4) ? `throw new RangeError("own " + k);` : `${random.pick(all)};`}`, `return k * 2;`],
    `}`,
    `function ${step}(k${a("number")})${a("number")} {`,
    [
      `let reached = 0;`,
      `try {`,
      [`${state}.a = k;`, `reached = 1;`, random.chance(0.5) ? `${state}.b = ${risky}(k);` : `${state}.b += ${risky}(k) + (reached = 2);`, `reached += 10;`, `${state}.c = k;`],
      ...(random.chance(0.6) ? [`} catch (error) {`, [`reached += 100;`, `${state}.c = -1;`]] : []),
      `} finally {`,
      [`${state}.a += 1000;`, ...(random.chance(0.3) ? [`return reached + 0.5;`] : [])],
      `}`,
      `return reached;`,
    ],
    `}`,
    `for (let k = 0; k < 4; k++) {`,
    g.guarded([`print("${step} " + k + " " + ${step}(k) + " " + ${state}.a + "," + ${state}.b + "," + ${state}.c);`]),
    `}`,
    `print("${state} " + ${state}.a + "," + ${state}.b + "," + ${state}.c);`,
  );
}

function hoisting(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  g.need("errorName");
  const pieces: (() => Code[])[] = [
    () => {
      const name = g.fresh("hoisted");
      return [
        `function ${name}(flag${a("boolean")})${a("string")} {`,
        [`if (flag) {`, [`var inner${a("number | undefined")} = ${g.int32(0)};`], `}`, `return typeof inner + ":" + inner;`],
        `}`,
        `print("${name} " + ${name}(true) + " " + ${name}(false));`,
      ];
    },
    () => {
      const name = g.fresh("later");
      return [`print("${name} " + ${name}(${g.int32(0)}));`, `function ${name}(value${a("number")})${a("number")} {`, [`return (value + ${g.int32(0)}) | 0;`], `}`];
    },
    () => {
      const name = g.fresh("zone");
      return [
        `function ${name}(early${a("boolean")})${a("string")} {`,
        [`const read = () => value;`, `try {`, [`if (early) return "early " + read();`], `} catch (error) {`, [`return errorName(error);`], `}`, `let value = ${g.int32(0)};`, `return "late " + read() + value;`],
        `}`,
        `print("${name} " + ${name}(true) + " " + ${name}(false));`,
      ];
    },
    () => {
      const name = g.fresh("perTurn");
      return [
        `const ${name}${a("(() => number)[]")} = [];`,
        `for (let i = 0; i < 6; i++) {`,
        [`${name}.push(() => i);`, `if (i % 2 === ${random.below(2)}) i++;`, `${name}.push(() => ++i);`],
        `}`,
        `print("${name} " + ${g.listing(name, "read", "read()")} + " " + ${g.listing(name, "read", "read()")});`,
      ];
    },
    () => {
      const name = g.fresh("shadow");
      return [
        `function ${name}(value${a("number")})${a("string")} {`,
        [
          `const seen${a("string[]")} = [];`,
          `{`,
          [`const value = "block";`, `seen.push(value);`],
          `}`,
          `try {`,
          [`throw value + 1;`],
          `} catch (value) {`,
          [`seen.push("caught " + value);`],
          `}`,
          `switch (value & 1) {`,
          [`case 0: {`, [`let value = "zero";`, `seen.push(value);`], `}`, `default:`, [`seen.push("default " + value);`]],
          `}`,
          `return seen.join();`,
        ],
        `}`,
        `print("${name} " + ${name}(${g.int32(0)}) + " " + ${name}(${g.int32(0)}));`,
      ];
    },
    () => {
      const name = g.fresh("named");
      return [
        `const ${name} = function me(depth${a("number")})${a("string")} {`,
        [`try {`, [`${g.cast("me")} = null;`], `} catch (error) {`, [`return errorName(error) + (depth > 0 ? me(depth - 1) : typeof me);`], `}`, `return "stored " + typeof me;`],
        `};`,
        `print("${name} " + ${name}(1) + " " + ${name}.name);`,
      ];
    },
  ];
  g.emitSome(pieces, random.between(1, 3));
}

/** A call site that saw one callee gets another: a variable, a property or an element that holds a function is stored again. */
function calleeChanges(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [holder, apply] = [g.fresh("op"), g.fresh("apply")];
  const type = "(value: number) => number";
  const first = `(value${a("number")}) => (value + ${g.int32(0)}) | 0`;
  const second = random.pick([`(value${a("number")}) => value * 0.5`, `(value${a("number")}) => -value`, `Math.sqrt`, `function (value${a("number")}) { return arguments.length; }`, `new Proxy((value${a("number")}) => value, {})`, `Math.abs.bind(null)`, `(value${a("number")}) => NaN`]);
  const [declaration, callee] = random.pick([
    [`let ${holder}${a(type)} = ${first};`, holder],
    [`const ${holder}${a(`{ run: ${type} }`)} = { run: ${first} };`, `${holder}.run`],
    [`const ${holder}${a(`(${type})[]`)} = [${first}];`, `${holder}[0]`],
    [`const ${holder} = new Map${g.typeArguments(`string, ${type}`)}([["run", ${first}]]);`, `${holder}.get("run")${g.typed ? "!" : ""}`],
  ]);
  const store = callee.includes(".get(") ? `${holder}.set("run", ${second});` : `${callee} = ${second};`;
  g.need("mix");
  g.emit(
    declaration,
    `function ${apply}(value${a("number")})${a("number")} {`,
    [`return ${callee}(value);`],
    `}`,
    `for (let i = 0; i < ${random.pick([3, 20])}; i++) mix(${apply}(i));`,
    `print("${apply} " + ${apply}(${g.int32(0)}));`,
    ...g.indirectly([store]),
    `print("${apply} " + ${apply}(${g.int32(0)}) + " " + ${apply}(9) + "/" + 1 / ${apply}(0));`,
  );
  g.declare(apply, { is: "function", parameters: [int32], result: number });
}

/** A captured variable that held one kind gets another, through one of several closures over it. */
function capturedVariables(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [make, box] = [g.fresh("makeBox"), g.fresh("box")];
  g.need("mix");
  g.emit(
    `function ${make}(start${a("number")}) {`,
    [`let state${a("any")} = start;`, `return {`, [`read: () => state,`, `write(value${a("unknown")}) {`, [`state = value;`], `},`, `bump: () => state++,`, `add: (value${a("number")}) => (state += value),`], `};`],
    `}`,
    `const ${box} = ${make}(${g.int32(0)});`,
    `const ${box}Other = ${make}(${g.int32(0)});`,
    `for (let i = 0; i < ${random.pick([2, 10])}; i++) mix(${box}.bump() + ${box}.add(i));`,
    `print("${box} " + ${box}.read() + " " + ${box}Other.read());`,
    ...g.indirectly([`${box}.write(${random.pick(otherValues)});`]),
    `print("${box} " + typeof ${box}.read() + " " + String(${box}.bump()) + " " + String(${box}.read()) + " " + String(${box}.add(1)) + " " + ${box}Other.bump());`,
  );
}

/**
 * The constructor of a base class runs with another `new.target`: an heir, a class from a factory, or whatever `Reflect.construct`
 * is given. It may call a method the heir overrides, read what the heir put on its prototype, have private names and leak `this`.
 */
function foreignNewTarget(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [base, heir, leaked, tell, make, other, old] = [g.fresh("Base"), g.fresh("Heir"), g.fresh("leaked"), g.fresh("tell"), g.fresh("make"), g.fresh("Other"), g.fresh("Old")];
  const self = g.cast("this");
  const does = { hook: random.chance(0.75), reads: random.chance(0.6), secret: random.chance(0.5), leaks: random.chance(0.6), storesLate: random.chance(0.6), target: random.chance(0.5) };
  const saw = [does.target ? `new.target.name` : `"built"`, ...(does.reads ? [`String(${self}.kindName)`] : []), `String(${self}.own)`];
  const hookOf = (stores: Code[]): Code[] => [`hook(value${a("number")})${a("void")} {`, stores, `}`];
  g.emit(
    `const ${leaked}${a("object[]")} = [];`,
    `class ${base} {`,
    [
      `first${a("number")} = ${g.int32(0)};`,
      ...(does.secret ? [`#secret${a("number")} = ${g.int32(0)};`] : []),
      `seen${a("string")};`,
      `constructor(a0${a("number")}) {`,
      [
        ...(does.leaks ? [`${leaked}.push(this);`] : []),
        `this.seen = ${saw.join(` + ":" + `)};`,
        ...(does.hook ? [`this.hook(a0);`] : []),
        ...(does.storesLate ? [`this.first = (this.first + a0) | 0;`] : []),
      ],
      `}`,
      ...hookOf([`this.first = value;`]),
      ...(does.secret ? [`secret()${a("number")} {`, [`return this.#secret;`], `}`, `static has(o${a("object")})${a("boolean")} {`, [`return #secret in o;`], `}`] : []),
    ],
    `}`,
  );
  const heirStores = (): Code[] =>
    random.sample<Code>(
      [`this.own = value * 2;`, `${self}.extra = value;`, `super.hook(value + 1);`, `this.first++;`, ...(does.secret ? [`this.first += this.secret();`] : []), ...(does.leaks ? [`${leaked}.push(this);`] : [])],
      random.between(1, 3),
    );
  g.emit(
    `class ${heir} extends ${base} {`,
    [
      random.pick([`own${a("number")} = ${g.int32(0)};`, `own${g.typed ? "!" : ""}${a("number")};`, ...(g.typed ? [`declare own: number;`] : [`static unused = 0;`])]),
      ...hookOf(heirStores()),
      ...(random.chance(0.3) ? [`get kindName() {`, [`return "getter";`], `}`] : []),
    ],
    `}`,
    random.pick([`${g.cast(`${heir}.prototype`)}.kindName ??= "on the prototype";`, `Object.defineProperty(${heir}.prototype, "kindName2", { value: 1 });`]),
    `function ${tell}(o${a("any")})${a("string")} {`,
    [
      `let keys = "";`,
      `for (const key in o) keys += key + ",";`,
      `return keys + " " + o.first + " " + o.seen + " " + String(o.own) + " " + String(o.extra) + " " + (o instanceof ${base}) + (o instanceof ${heir})${does.secret ? ` + ${base}.has(o)` : ""}${does.leaks ? ` + (${leaked}[${leaked}.length - 1] === o)` : ""};`,
    ],
    `}`,
  );
  const value = () => g.int32(0);
  const ways: (() => { before: Code[]; made: string })[] = [
    () => ({ before: [], made: `new ${heir}(${value()})` }),
    () => ({ before: [], made: `new ${base}(${value()})` }),
    () => ({ before: [], made: `Reflect.construct(${base}, [${value()}], ${heir})` }),
    () => ({ before: [], made: `Reflect.construct(${heir}, [${value()}], ${base})` }),
    () => ({
      before: [`const ${make} = (Parent${a(`typeof ${base}`)}) =>`, [`class extends Parent {`, [`made${a("number")} = ${value()};`, ...hookOf([`${self}.fromFactory = value;`, ...(random.chance(0.5) ? [`super.hook(value);`] : [])])], `};`]],
      made: `new (${make}(${random.pick([base, heir, `${make}(${base})`])}))(${value()})`,
    }),
    () => ({ before: [`class ${other} {`, hookOf([`${self}.other = value;`]), `}`], made: `Reflect.construct(${base}, [${value()}], ${other})` }),
    () => ({
      before: [
        `function ${old}(${g.typed ? "this: unknown, " : ""}a0${a("number")}) {`,
        [`return Reflect.construct(${base}, [a0], new.target ?? ${old});`],
        `}`,
        `Object.setPrototypeOf(${old}.prototype, ${base}.prototype);`,
        `${old}.prototype.hook = function (${g.typed ? "this: any, " : ""}value${a("number")}) {`,
        [`this.old = value;`],
        `};`,
      ],
      made: random.pick([`new ${g.cast(old)}(${value()})`, `${g.cast(old)}(${value()})`]),
    }),
    () => ({ before: [], made: `Reflect.construct(${base}, [${value()}], ${random.pick([`${heir}.bind(null)`, `new Proxy(${heir}, {})`, "Object", "Array", "Map", "Error", "function () {}", `Object.assign(function () {}, { prototype: 5 })`, `class { static prototype2 = 1; }`])})` }),
    () => ({ before: [`${heir}.prototype.hook = function (${g.typed ? `this: ${heir}, ` : ""}value${a("number")}) {`, [`this.own = -value;`], `};`], made: `new ${heir}(${value()})` }),
    () => ({ before: [`Object.setPrototypeOf(${heir}.prototype, { hook() {} });`], made: `new ${heir}(${value()})` }),
  ];
  const label = g.fresh("made");
  random.sample(ways, random.between(3, 5)).forEach((way, i) => {
    const { before, made } = way();
    g.emit(...before, ...g.attempt([`"${label}${i} " + ${tell}(${made})`]));
  });
  if (does.leaks) g.emit(`print("${leaked} " + ${leaked}.length + " " + ${g.listing(leaked, "o", tell + "(o).length")});`);
}

/** One class expression evaluated several times: computed member names, statics named like members of Function.prototype, private names. */
function classFactories(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [make, base, extend] = [g.fresh("makeClass"), g.fresh("Base"), g.fresh("extend")];
  const staticName = random.pick(["call", "apply", "bind", "toString", "constructor", "name2", "length2"]);
  const hidden = random.chance(0.5);
  g.emit(
    `function ${make}(tag${a("string")}, key${a("string")})${a("any")} {`,
    [
      `return class {`,
      [
        // TypeScript takes `static constructor` for a constructor.
        `static ${g.typed && staticName === "constructor" ? `["constructor"]` : staticName}(o${a("unknown")}) {`,
        [`return tag + String(o);`],
        `}`,
        `static tag = tag;`,
        ...(hidden ? [`#hidden = tag + "!";`, `reveal() {`, [`return this.#hidden;`], `}`] : []),
        `[key]() {`,
        [`return tag + ":" + key;`],
        `}`,
        `who() {`,
        [`return tag;`],
        `}`,
      ],
      `};`,
    ],
    `}`,
  );
  const [first, second] = [g.fresh("K"), g.fresh("K")];
  const keys = random.sample(["m", "n", "who", "constructor2", "0"], 2);
  g.emit(
    `const ${first} = ${make}("a", ${g.computedKey(keys[0])});`,
    `const ${second} = ${make}("b", ${g.computedKey(keys[1])});`,
    `print("${make} " + ${first}.${staticName}(1) + " " + ${second}.${staticName}(2) + " " + new ${first}()["${keys[0]}"]() + " " + typeof new ${first}()["${keys[1]}"] + " " + new ${second}()["${keys[1]}"]() + " " + new ${first}().who() + " " + (${first} === ${second}) + " " + (new ${first}() instanceof ${second}) + " " + ${first}.tag + ${second}.tag);`,
  );
  if (hidden) g.emit(...g.attempt([`"${make} hidden " + new ${first}().reveal() + " " + new ${second}().reveal()`, `"${make} foreign " + ${first}.prototype.reveal.apply(new ${second}())`]));
  g.emit(
    `class ${base} {`,
    [`m()${a("string")} {`, [`return "base m";`], `}`, `n()${a("string")} {`, [`return "base n";`], `}`],
    `}`,
    `function ${extend}(key${a("string")})${a(`new () => ${base}`)} {`,
    [`return class extends ${base} {`, [`[key]() {`, [`return "own " + key;`], `}`], `};`],
    `}`,
    `print("${extend} " + ${g.listing(`["m", "other", "n", "m"]`, "key", `new (${extend}(key))().m() + "/" + new (${extend}(key))().n()`)});`,
  );
}

/** The `name` and `length` that functions get from where they are written. */
function functionNames(g: Generator): void {
  const { random } = g;
  const key = g.fresh("key");
  const symbol = g.fresh("symbol");
  const holder = g.fresh("named");
  const klass = g.fresh("Named");
  const loose = g.cast(holder);
  g.emit(
    `const ${key} = ${g.computedKey("computed")};`,
    `const ${symbol} = Symbol("described");`,
    `const ${holder} = {`,
    [
      `method() {},`,
      `expression: function () {},`,
      `arrow: () => {},`,
      `named: function inner() {},`,
      `[${key}]: function () {},`,
      `[${symbol}]: () => {},`,
      `[Symbol.iterator]() {},`,
      `get reader() {`,
      [`return 1;`],
      `},`,
      `async later() {},`,
      `*items() {},`,
      `klass: class {},`,
    ],
    `};`,
    `class ${klass} {`,
    [`static fixed() {}`, `field = () => {};`, `[Symbol.toPrimitive]() {`, [`return 1;`], `}`, `static [Symbol.hasInstance]() {`, [`return false;`], `}`, `get [Symbol.toStringTag]() {`, [`return "tag";`], `}`, `#hidden() {}`, `hiddenName() {`, [`return this.#hidden.name;`], `}`],
    `}`,
  );
  const names = [
    ...["method", "expression", "arrow", "named", "later", "items", "klass"].map(name => `${holder}.${name}.name`),
    `${loose}[${key}].name`,
    `${loose}[${symbol}].name`,
    `${holder}[Symbol.iterator].name`,
    `Object.getOwnPropertyDescriptor(${holder}, "reader")${g.typed ? "!" : ""}.get${g.typed ? "!" : ""}.name`,
    `${klass}.name`,
    `${klass}.fixed.name`,
    `new ${klass}().field.name`,
    `${klass}.prototype[Symbol.toPrimitive].name`,
    `${klass}[Symbol.hasInstance].name`,
    `Object.getOwnPropertyDescriptor(${klass}.prototype, Symbol.toStringTag)${g.typed ? "!" : ""}.get${g.typed ? "!" : ""}.name`,
    `new ${klass}().hiddenName()`,
    `${holder}.method.bind(null).name`,
    `(() => {}).name`,
    `(function () {}).name`,
    `(class {}).name`,
    `((a${g.annotation("number")}, b = 1, ...c${g.annotation("number[]")}) => {}).length`,
    `(function (a${g.annotation("number")}, b${g.annotation("number")}) {}).bind(null, 1).length`,
    `${klass}.length`,
  ];
  g.emit(`print("${holder} " + [${random.sample(names, random.between(6, 12)).join(", ")}].join("|"));`);
  if (random.chance(0.5)) {
    const late = g.fresh("late");
    g.emit(`const ${late}${g.annotation("Record<string, Function>")} = {};`, `${late}.assigned = function () {};`, `let ${late}Variable = function () {};`, `${late}Variable = () => {};`, `print("${late} [" + ${late}.assigned.name + "] " + ${late}Variable.name);`);
  }
}

/** One call site `x.m()` whose receivers hold the method in different places. */
function methodCallers(g: Generator): void {
  const { random } = g;
  const [run, shared, klass, old] = [g.fresh("run"), g.fresh("shared"), g.fresh("C"), g.fresh("F")];
  const type = `{ m(): number }`;
  g.emit(
    `function ${run}(x${g.annotation(type)})${g.annotation("number")} {`,
    [`return x.m();`],
    `}`,
    `const ${shared} = { m() { return ${g.int32(0)}; } };`,
    `class ${klass} {`,
    [`m() {`, [`return ${g.int32(0)};`], `}`],
    `}`,
    `function ${old}(${g.typed ? "this: unknown" : ""}) {}`,
    `${old}.prototype.m = function () {`,
    [`return ${g.int32(0)};`],
    `};`,
  );
  const receivers = [
    shared,
    `Object.create(${shared})`,
    `{ m() { return ${g.int32(0)}; } }`,
    `{ m: () => ${g.int32(0)} }`,
    `${g.cast(`{ __proto__: ${shared} }`, `unknown as ${type}`)}`,
    `new ${klass}()`,
    `new (class extends ${klass} {})()`,
    `new ${g.cast(old)}()`,
    `Object.create(Object.create(${shared}))`,
    `{ get m() { return () => ${g.int32(0)}; } }`,
    `new Proxy(${shared}, {})`,
    `Object.assign(Object.create(${shared}), { m: () => ${g.int32(0)} })`,
    `Object.setPrototypeOf({}, ${klass}.prototype)`,
    `Object.assign(() => 0, { m: () => ${g.int32(0)} })`,
    `Object.assign([1], { m() { return ${g.int32(0)}; } })`,
  ];
  g.emit(`print("${run} " + [${random.sample(receivers, random.between(3, 6)).map(receiver => `${run}(${receiver})`).join(", ")}].join());`);
  if (random.chance(0.6)) {
    g.emit(
      ...g.indirectly([random.pick([`${shared}.m = () => ${g.int32(0)};`, `${klass}.prototype.m = () => ${g.int32(0)};`, `${old}.prototype.m = () => ${g.int32(0)};`, `delete ${g.cast(shared)}.m;`, `Object.setPrototypeOf(${klass}.prototype, ${shared});`, `delete ${g.cast(`${klass}.prototype`)}.m;`])]),
      ...g.attempt([`"${run} shared " + ${run}(Object.create(${shared}))`, `"${run} class " + ${run}(new ${klass}())`, `"${run} function " + ${run}(new ${g.cast(old)}())`]),
    );
  }
}

/** Accessors with only one half, and the old ways to define them. */
function accessorForms(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [read, count] = [g.fresh("read"), g.fresh("count")];
  g.emit(`let ${count} = 0;`, `function ${read}(o${a("{ a: number; b: number }")})${a("string")} {`, [`return o.a + o.b + ":" + typeof o.a;`], `}`);
  const pieces: (() => Code[])[] = [
    () => {
      const name = g.fresh("later");
      const define = random.pick([
        `${g.cast(name)}.__defineSetter__("a", () => ${count}++);`,
        `${g.cast(name)}.__defineGetter__("a", () => ${g.int32(0)});`,
        `Object.defineProperty(${name}, "a", { set(value) { ${count}++; }, configurable: true });`,
        `Object.defineProperty(${name}, "a", { get: () => ${g.int32(0)}, configurable: true });`,
        `Object.defineProperty(${name}, ${g.computedKey("a")}, { get: undefined, set: undefined });`,
      ]);
      return [
        `const ${name} = { a: ${g.int32(0)}, b: ${g.int32(0)} };`,
        `print("${name} " + ${read}(${name}));`,
        ...g.indirectly([define]),
        ...g.attempt([`"${name} " + ${read}(${name})`, `"${name} store " + (${name}.a = ${g.int32(0)})`, `"${name} " + ${read}(${name}) + " " + ${count} + " " + ${g.keysOf(name)} + " " + typeof ${g.cast(name)}.__lookupGetter__("a") + typeof ${g.cast(name)}.__lookupSetter__("a")`]),
      ];
    },
    () => {
      const name = g.fresh("C");
      return [
        `class ${name} {`,
        [`b = ${g.int32(0)};`, `constructor() {`, [`this.a = ${g.int32(0)};`], `}`, `set a(value${a("number")}) {`, [`${count}++;`], `}`],
        `}`,
        `const ${name}One = new ${name}();`,
        `${name}One.a = ${g.int32(0)};`,
        `print("${name} " + ${count} + " " + ${g.keysOf(`${name}One`)} + " " + String(${name}One.a) + " " + ("a" in ${name}One) + " " + Object.hasOwn(${name}One, "a"));`,
      ];
    },
    () => {
      const name = g.fresh("onlyGet");
      return [
        `const ${name} = { get a() { return ${g.int32(0)}; }, b: ${g.int32(0)} };`,
        ...g.attempt([`"${name} " + ${read}(${name})`, `"${name} store " + (${g.cast(name)}.a = 1)`, `"${name} heir " + (${g.cast(`Object.create(${name})`)}.a = 1)`, `"${name} " + ${read}(${name})`]),
      ];
    },
    () => {
      const [parent, child] = [g.fresh("parent"), g.fresh("child")];
      return [
        `const ${parent} = { stored: 0, set a(value${a("number")}) { this.stored = value; }, get a() { return this.stored + 1; }, b: 1 };`,
        `const ${child}${a(`typeof ${parent}`)} = Object.create(${parent});`,
        `${child}.a = ${g.int32(0)};`,
        `print("${child} " + ${read}(${child}) + " " + ${g.keysOf(child)} + " " + ${parent}.stored + " " + ${child}.stored + " " + Object.hasOwn(${child}, "a") + Object.hasOwn(${child}, "stored"));`,
      ];
    },
  ];
  g.emitSome(pieces, random.between(1, 3));
}

/** Names that a descriptor creates: without more words they are read-only, hidden and fixed. */
function definedNames(g: Generator): void {
  const { random } = g;
  const name = g.fresh("defined");
  const flags = () => [random.pick(["", "writable: true", "writable: false"]), random.pick(["", "enumerable: true"]), random.pick(["", "configurable: true"])].filter(Boolean).join(", ");
  const descriptor = (value: string) => `{ ${[`value: ${value}`, flags()].filter(Boolean).join(", ")} }`;
  const type = g.annotation("Record<string, unknown>");
  g.emit(
    ...random.pick<Code[]>([
      [`const ${name}${type} = { a: ${g.string(0)} };`, `Object.defineProperty(${name}, ${g.computedKey("q")}, ${descriptor(g.int32(0))});`, `Object.defineProperty(${name}, "p", ${descriptor(g.string(0))});`],
      [`const ${name}${type} = {};`, `Object.defineProperties(${name}, { q: ${descriptor(g.int32(0))}, p: ${descriptor(g.string(0))} });`],
      [`const ${name}${type} = {};`, `Object.defineProperties(${name}, { q: { get() { return ${g.string(0)}; } }, p: ${descriptor(g.string(0))} });`],
      [`const ${name}${type} = Object.create({ inherited: 1 }, { q: ${descriptor(g.int32(0))}, p: ${descriptor(g.string(0))} });`],
      [`const ${name}${type} = { q: ${g.int32(0)}, p: ${g.string(0)} };`, `Object.defineProperty(${name}, "q", { ${flags() || "enumerable: false"} });`],
      [`const ${name}${type} = {};`, `Reflect.defineProperty(${name}, "q", ${descriptor(g.int32(0))});`, `${name}.p = ${g.string(0)};`],
    ]),
    `print("${name} " + typeof ${name}.p + " " + String(${name}.q) + " " + ${g.keysOf(name)});`,
    ...g.attempt([`"${name} store " + (${name}.q = ${g.int32(0)})`, `"${name} delete " + delete ${name}.p`, `"${name} again " + Object.defineProperty(${name}, "q", { value: ${g.int32(0)} }).q`]),
    `print("${name} " + String(${name}.p) + " " + String(${name}.q) + " " + ${g.keysOf(name)} + " " + JSON.stringify(${name}) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(${name}, "q")) + " " + Object.getOwnPropertyNames(${name}).join());`,
  );
}

function bindChains(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [f, h, out] = [g.fresh("f"), g.fresh("bound"), g.fresh("out")];
  const optional = g.typed ? "?" : "";
  g.emit(
    `function ${f}(${g.typed ? "this: any, " : ""}a${optional}${a("unknown")}, b${optional}${a("unknown")}, c${optional}${a("unknown")})${a("string")} {`,
    [`return (b === undefined ? "missing" : typeof b) + ":" + String(a) + ":" + String(c) + ":" + arguments.length + ":" + String(this?.tag);`],
    `}`,
    `const ${h} = ${f}.bind(${random.pick(["null", "undefined", `{ tag: "first" }`])});`,
    `const ${h}s = [${h}.bind(null, 1, 2), ${h}.bind({ tag: "second" }, 2, "x"), ${h}.bind(null, 3), ${h}.bind(null), ${g.cast(h)}.bind(null, 4, 5, 6, 7)];`,
    `let ${out} = "";`,
    `for (let i = 0; i < ${h}s.length; i++) ${out} += ${h}s[i](${random.pick(["", "i", `"extra", i`])}) + ";";`,
    `print("${out} " + ${out} + " " + ${g.listing(`${h}s`, "item", `item.length + item.name`)});`,
  );
  if (random.chance(0.4)) {
    const most = g.fresh("most");
    g.emit(
      `const ${most} = [Math.max.bind(null, 1, 2), Math.max.bind(null), Math.max.bind(null, ${g.number(0)})];`,
      `print("${most} " + ${g.listing(most, "item", "item() + \"/\" + item(5)")});`,
    );
  }
  if (random.chance(0.4)) {
    const [nine, base] = [g.fresh("nine"), g.fresh("nineBound")];
    const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    g.emit(
      `function ${nine}(${names.map(name => name + optional + a("unknown")).join(", ")})${a("string")} {`,
      [`return typeof a + String(h) + (i === undefined ? "missing" : String(i));`],
      `}`,
      `const ${base} = ${nine}.bind(null);`,
      `print("${nine} " + ${g.listing(`[${base}.bind(null, 0), ${base}.bind(null, "x"), ${base}.bind(null)]`, "item", `${g.cast("item")}(1, 2, 3, 4, 5, 6, 7, 8)`)});`,
    );
  }
  if (random.chance(0.5)) {
    const point = g.fresh("Point");
    g.emit(
      `function ${point}(${g.typed ? "this: any, " : ""}x${a("number")}, y${a("number")}) {`,
      [`this.x = x;`, `this.y = y;`],
      `}`,
      `const ${point}Bound = ${g.cast(`${point}.bind({ ignored: true }, ${g.int32(0)})`)};`,
      `const ${point}Made = new ${point}Bound(${g.int32(0)});`,
      `print("${point} " + ${point}Made.x + "," + ${point}Made.y + " " + (${point}Made instanceof ${point}) + " " + (${point}Made instanceof ${point}Bound) + " " + ("prototype" in ${point}Bound));`,
    );
  }
}

/** A variable that holds one of several shapes or null goes through a chain of small functions that read and store. */
function shapeUnions(g: Generator): void {
  const { random } = g;
  const [make, deep, middle, outer, current] = [g.fresh("makeShape"), g.fresh("deep"), g.fresh("middle"), g.fresh("outer"), g.fresh("current")];
  const union = g.fresh("U");
  g.emitType(`type ${union} = { x: number; z: number | string; w?: number; y?: number } | null;`);
  const u = g.annotation(union);
  g.need("mix");
  g.emit(
    `function ${make}(c${g.annotation("number")})${u} {`,
    [`return c % 3 === 0 ? { x: c, z: ${g.int32(0)} } : c % 3 === 1 ? ${random.pick(["null", `{ z: 1, x: c }`])} : { z: ${g.string(0)}, x: c, w: ${g.int32(0)} };`],
    `}`,
    `function ${deep}(o${u})${u} {`,
    [`if (o) o.y = (o.y ?? 0) + 1;`, `return o;`],
    `}`,
    `function ${middle}(o${u})${g.annotation("number | undefined")} {`,
    [`${deep}(o);`, `const w = o?.w;`, `${deep}(o);`, `return w;`],
    `}`,
    `function ${outer}(o${u})${g.annotation("void")} {`,
    [`mix(${middle}(o) ?? -1);`],
    `}`,
    `let ${current}${u} = { x: ${g.int32(0)}, z: ${g.int32(0)} };`,
    `for (let c = 0; c < ${random.between(4, 9)}; c++) {`,
    [`if (${random.pick(["c & 1", "c % 3 === 0", "c > 2"])}) ${outer}(${current});`, `else ${current} = ${make}(c)${random.chance(0.5) ? ` ?? ${current}` : ""};`],
    `}`,
    `print("${current} " + (${current} ? ${current}.x + "," + ${current}.z + "," + ${current}.w + "," + ${current}.y + " " + ${g.keysOf(current)} : "null"));`,
  );
}

/** What runs first decides: a `var` is read before the line that stores it has run. */
function executionOrder(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [f, plain, table, key, k, use] = [g.fresh("F"), g.fresh("plain"), g.fresh("table"), g.fresh("key"), g.fresh("k"), g.fresh("use")];
  g.need("errorName");
  g.emit(
    `function ${f}(${g.typed ? "this: any" : ""}) {`,
    [`this.x = 1;`],
    `}`,
    `const ${plain}${a("Record<string, unknown>")} = {};`,
    `const ${table}${a("Record<string, any>")} = { a: ${f}.prototype, undefined: ${plain} };`,
    `function ${key}()${a("string")} {`,
    [`return ${k};`],
    `}`,
    ...(random.chance(0.5) ? [`${table}[${key}()].m = function () {`, [`return 1;`], `};`, `var ${k} = "a";`] : [`var ${k} = "a";`, `${table}[${key}()].m = function () {`, [`return 1;`], `};`]),
    `function ${use}(o${a("any")})${a("unknown")} {`,
    [`return o.m();`],
    `}`,
    ...g.attempt([`"${use} " + ${use}(new ${g.cast(f)}())`]),
    `print("${plain} " + typeof ${plain}.m + " " + typeof ${f}.prototype.m);`,
  );
}

/** Function expressions under computed keys that store to `this`, as hand-written iterators do. */
function computedFunctionKeys(g: Generator): void {
  const { random } = g;
  const name = g.fresh("walker");
  const limit = random.between(1, 4);
  g.emit(
    `const ${name}${g.annotation("any")} = {`,
    [
      `[Symbol.iterator]: function () {`,
      [`this.i = 0;`, `return this;`],
      `},`,
      `next: function () {`,
      [`return { done: this.i >= ${limit}, value: this.i++ };`],
      `},`,
      `[Symbol.hasInstance]: function (value${g.annotation("unknown")}) {`,
      [`this.asked = value;`, `return true;`],
      `},`,
      `[${g.computedKey("plain")}]: function () {`,
      [`this.n = (this.n ?? 0) + 1;`, `return this.n;`],
      `},`,
    ],
    `};`,
    `let ${name}Text = "";`,
    `for (const value of ${name}) ${name}Text += value + ",";`,
    `const [${name}First, ${name}Second] = ${name};`,
    `print("${name} " + ${name}Text + " " + ${name}First + ${name}Second + " " + ${name}.i + " " + (${g.cast("5")} instanceof ${name}) + " " + ${name}.asked + " " + ${name}.plain() + ${name}.plain() + " " + new ${name}.plain().n + " " + ${g.keysOf(name)});`,
  );
}

/** A class that extends a constructor function. */
function functionBases(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [point, below, unrelated] = [g.fresh("Point"), g.fresh("Below"), g.fresh("Unrelated")];
  g.emitType(`type ${point}Instance = { px: number; sum(): number };`);
  g.emit(
    `${random.pick([`function ${point}`, `const ${point} = function`])}(${g.typed ? `this: ${point}Instance, ` : ""}x${a("number")}) {`,
    [`this.px = x;`],
    `}${""}`,
    `${point}.prototype.sum = function (${g.typed ? "this: any" : ""}) {`,
    [`return this.px + (this.py ?? 0) + (this.z ?? 0);`],
    `};`,
    `class ${below} extends ${g.cast(point, `unknown as new (x: number) => ${point}Instance`)} {`,
    [`z${a("number")} = ${g.int32(0)};`, `py${a("number")};`, `constructor(x${a("number")}) {`, [`super(x);`, `this.py = x + 1;`], `}`],
    `}`,
    `class ${unrelated} {}`,
  );
  const tell = (made: string) => `(o => ${g.keysOf("o")} + " " + JSON.stringify(o) + " " + String(o.sum?.()) + " " + (o instanceof ${below}) + (o instanceof ${point}))(${made})`;
  const ways = [`new ${below}(${g.int32(0)})`, `Reflect.construct(${below}, [${g.int32(0)}], ${unrelated})`, `Reflect.construct(${below}, [${g.int32(0)}], ${point})`, `Reflect.construct(${point}, [${g.int32(0)}], ${below})`, `new (class extends ${below} { w = 1; })(${g.int32(0)})`, `new ${g.cast(point)}(${g.int32(0)})`, `new ${g.cast(`(class extends class extends ${g.cast(point)} {} {})`)}(${g.int32(0)})`];
  g.emit(...g.attempt(random.sample(ways, random.between(2, 4)).map((way, i) => `"${below}${i} " + ${tell(g.cast(way))}`)));
}

/** Objects told apart by a literal field, handled by a switch. */
function discriminatedUnions(g: Generator): void {
  const { random } = g;
  const [union, area, list] = [g.fresh("Figure"), g.fresh("measure"), g.fresh("figures")];
  g.emitType(`type ${union} = { kind: "circle"; r: number } | { kind: "box"; w: number; h: number } | { kind: "dot"; label?: string };`);
  g.emit(
    `function ${area}(f${g.annotation(union)})${g.annotation("number | string")} {`,
    [
      `switch (f.kind) {`,
      [`case "circle":`, [`return f.r * f.r * 3;`], `case "box":`, [`return (f.w * f.h) | 0;`], `default:`, [`return f.label ?? "no label";`]],
      `}`,
    ],
    `}`,
    `const ${list}${g.annotation(`${union}[]`)} = [{ kind: "circle", r: ${g.number(0)} }, { kind: "box", w: ${g.int32(0)}, h: ${g.int32(0)} }, { kind: "dot" }, { h: ${g.int32(0)}, kind: "box", w: ${g.int32(0)} }, { kind: "dot", label: ${g.string(0)} }];`,
    `print("${area} " + ${g.listing(list, "f", `${area}(f)`)});`,
  );
  const index = random.below(5);
  g.emit(
    ...g.indirectly([
      random.pick([
        `${list}[${index}] = { kind: "dot", label: ${g.string(0)} };`,
        `${g.cast(`${list}[${index}]`)}.kind = "dot";`,
        `${g.cast(`${list}[${index}]`)}.kind = "box";`,
        `${list}.push({ kind: "circle", r: ${g.number(0)} });`,
        `delete ${g.cast(`${list}[${index}]`)}.kind;`,
        `Object.assign(${list}[${index}], { kind: "circle", r: ${g.int32(0)} });`,
      ]),
    ]),
    `print("${area} " + ${g.listing(list, "f", `${area}(f) + "/" + ${g.keysOf("f")}`)});`,
  );
}

function generics(g: Generator): void {
  const { random } = g;
  const [box, identity, pair] = [g.fresh("Box"), g.fresh("same"), g.fresh("pair")];
  const t = (text: string) => (g.typed ? text : "");
  g.emit(
    `class ${box}${t("<T>")} {`,
    [
      `value${t(": T")};`,
      `history${t(": T[]")} = [];`,
      `constructor(value${t(": T")}) {`,
      [`this.value = value;`],
      `}`,
      `put(value${t(": T")})${t(": this")} {`,
      [`this.history.push(this.value);`, `this.value = value;`, `return this;`],
      `}`,
      `turn${t("<U>")}(change${t(": (value: T) => U")})${t(`: ${box}<U>`)} {`,
      [`return new ${box}(change(this.value));`],
      `}`,
    ],
    `}`,
    `function ${identity}${t("<T>")}(value${t(": T")})${t(": T")} {`,
    [`return value;`],
    `}`,
    `function ${pair}${t("<A, B>")}(a${t(": A")}, b${t(": B")})${t(": [A, B]")} {`,
    [`return [a, b];`],
    `}`,
  );
  const [numbers, texts, nested] = [g.fresh("box"), g.fresh("box"), g.fresh("box")];
  g.emit(
    `const ${numbers} = new ${box}${g.typeArguments("number")}(${g.int32(1)}).put(${g.int32(0)}).put(${g.number(0)});`,
    `const ${texts} = new ${box}${g.typeArguments("string")}(${g.string(1)}).put(${g.string(0)});`,
    `const ${nested} = ${numbers}.turn(value => new ${box}(String(value)));`,
    `print("${box} " + ${numbers}.value + " " + ${numbers}.history.join() + " " + ${texts}.value + " " + ${texts}.history.length + " " + ${nested}.value.value + " " + ${identity}(${numbers}).value + " " + ${identity}(${g.string(0)}).length + " " + ${pair}(${identity}(${g.int32(0)}), ${texts})[1].value + " " + ${texts}.turn(value => value.length).value);`,
  );
  if (random.chance(0.5)) g.emit(`print("${box} mixed " + ${g.listing(`[${numbers}, ${texts}, ${nested}, new ${box}(null), new ${box}([1])]`, "item", `typeof item.value + item.history.length`)});`);
}

/** An enum in TypeScript; in JavaScript the object it stands for. */
function enums(g: Generator): void {
  const { random } = g;
  const [color, level, name] = [g.fresh("Color"), g.fresh("Level"), g.fresh("nameOf")];
  const start = random.pick(["", " = 1", " = 5"]);
  const first = start ? Number(start.slice(3)) : 0;
  const blue = (first + 1) * 2 + 1;
  g.emitEither(
    [`enum ${color} {`, [`Red${start},`, `Green,`, `Blue = Green * 2 + 1,`], `}`, `enum ${level} {`, [`Low = "low",`, `High = "high",`], `}`],
    [`const ${color} = { Red: ${first}, ${first}: "Red", Green: ${first + 1}, ${first + 1}: "Green", Blue: ${blue}, ${blue}: "Blue" };`, `const ${level} = { Low: "low", High: "high" };`],
  );
  g.emit(
    `function ${name}(color${g.annotation(color)}, level${g.annotation(level)})${g.annotation("string")} {`,
    [`switch (color) {`, [`case ${color}.Red:`, [`return "red " + level;`], `case ${color}.Blue:`, [`return "blue " + (level === ${level}.High);`]], `}`, `return ${color}[color] + color;`],
    `}`,
    `print("${color} " + ${name}(${color}.Red, ${level}.Low) + " " + ${name}(${color}.Green, ${level}.High) + " " + ${name}(${color}.Blue, ${level}.High) + " " + ${color}[${color}.Blue] + " " + Object.keys(${color}).join() + " " + Object.values(${level}).join() + " " + (${color}.Green | ${color}.Blue) + " " + ${name}(${color}.Red | 0, ${level}.Low));`,
  );
}

/** Several classes behind one interface or one abstract class. */
function interfaces(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [shape, base, one, two, three, total] = [g.fresh("Sized"), g.fresh("Base"), g.fresh("C"), g.fresh("C"), g.fresh("C"), g.fresh("total")];
  g.emitType(`interface ${shape} { size(): number; readonly tag: string; extra?: number }`);
  g.emit(
    `${g.typed ? "abstract " : ""}class ${base}${g.typed ? ` implements ${shape}` : ""} {`,
    [...(g.typed ? [`abstract size(): number;`] : []), `tag${a("string")} = "base";`, `twice()${a("number")} {`, [`return this.size() * 2;`], `}`],
    `}`,
    `class ${one} extends ${base} {`,
    [`n${a("number")} = ${g.int32(0)};`, `size()${a("number")} {`, [`return this.n;`], `}`],
    `}`,
    `class ${two} extends ${base} {`,
    [`tag = "two";`, `extra = ${g.int32(0)};`, `size()${a("number")} {`, [`return ${g.number(0)};`], `}`],
    `}`,
    `class ${three}${g.typed ? ` implements ${shape}` : ""} {`,
    [`get tag() {`, [`return "three";`], `}`, `size()${a("number")} {`, [`return ${g.int32(0)};`], `}`],
    `}`,
    `function ${total}(items${a(`${shape}[]`)})${a("string")} {`,
    [`let sum = 0;`, `let tags = "";`, `for (const item of items) {`, [`sum += item.size() + (item.extra ?? 0);`, `tags += item.tag + ",";`], `}`, `return sum + " " + tags;`],
    `}`,
    `print("${total} " + ${total}([new ${one}(), new ${two}(), new ${three}(), { size: () => ${g.int32(0)}, tag: "literal" }]) + " " + new ${one}().twice() + " " + new ${two}().twice());`,
  );
  if (random.chance(0.5)) g.emit(...g.indirectly([`${random.pick([one, two, three])}.prototype.size = () => ${g.number(0)};`]), `print("${total} " + ${total}([new ${one}(), new ${two}(), new ${three}()]) + " " + new ${one}().twice());`);
}

function tuples(g: Generator): void {
  const { random } = g;
  const [entry, swap, list] = [g.fresh("entry"), g.fresh("swap"), g.fresh("rows")];
  g.emit(
    `const ${entry}${g.annotation("[number, string, boolean?]")} = [${g.int32(0)}, ${g.string(0)}];`,
    `function ${swap}([a, b]${g.annotation("[number, string, boolean?]")})${g.annotation("[string, number]")} {`,
    [`return [b, a];`],
    `}`,
    `const ${list}${g.annotation("[number, string, boolean?][]")} = [${entry}, [${g.int32(0)}, ${g.string(0)}, true], [${g.number(0)}, ${g.string(0)}]];`,
    `${entry}[0] ${random.pick(["+= 1", "*= 0.5", "= -0", "++"])};`,
    `${entry}[2] = ${random.pick(["false", "undefined", "true"])};`,
    `print("${entry} " + ${entry}.length + " " + ${entry}.join() + " " + ${swap}(${entry}).join() + " " + ${g.listing(list, "[n, s, flag]", `n + s + flag`)} + " " + ${swap}(${list}[2])[0].length);`,
  );
  const frozen = g.fresh("fixed");
  g.emit(`const ${frozen} = [${g.int32(0)}, ${g.string(0)}]${g.typed ? " as const" : ""};`, `print("${frozen} " + ${frozen}[0] + ${frozen}[1] + ${frozen}.length + Object.isFrozen(${frozen}));`);
}

/** An object used as a dictionary: keys come and go. */
function dictionaries(g: Generator): void {
  const { random } = g;
  const [table, count] = [g.fresh("counts"), g.fresh("countWords")];
  const create = random.pick(["{}", "Object.create(null)", "{ a: 0 }"]);
  // Under an inherited name a typed dictionary would give a value that is no number.
  const inherited = g.typed && create !== "Object.create(null)" ? ["c", "d", "e", "f"] : ["constructor", "__proto__", "toString", "hasOwnProperty"];
  const words = random.shuffled(["a", "b", "a", "10", "2", "b", "a", "-1", ...inherited]).slice(0, 8);
  g.emit(
    `function ${count}(words${g.annotation("string[]")})${g.annotation("Record<string, number>")} {`,
    [`const found${g.annotation("Record<string, number>")} = ${create};`, `for (const word of words) found[word] = (${random.pick(["found[word] ?? 0", "found[word] || 0", "Object.hasOwn(found, word) ? found[word] : 0", "word in found ? found[word] : 0"])}) + 1;`, `return found;`],
    `}`,
    `const ${table} = ${count}(${JSON.stringify(words)});`,
    `print("${table} " + Object.keys(${table}).join() + " " + ${g.listing(`Object.values(${table})`, "value", `(typeof value === "number" ? value : typeof value)`)} + " " + String(${table}.a) + " " + ("b" in ${table}) + " " + String(Object.getPrototypeOf(${table}) === Object.prototype));`,
    `delete ${table}[${g.computedKey(words[0])}];`,
    `${table}[${g.computedKey(words[1])}] = ${g.int32(0)};`,
    `${table}.zz = 1;`,
    `let ${table}Text = "";`,
    `for (const key in ${table}) ${table}Text += key + "=" + (typeof ${table}[key] === "number" ? ${table}[key] : typeof ${table}[key]) + ";";`,
    `print("${table} " + ${table}Text);`,
  );
}

/** Fields declared in the parameter list of a constructor; in JavaScript the stores they stand for. */
function parameterProperties(g: Generator): void {
  const [name, heir] = [g.fresh("C"), g.fresh("C")];
  const fields = someFields(g, 2);
  const model: ClassModel = { name, type: name, isFunction: false, fields: [...fields, { name: "ready", kind: boolean }], methods: [], parameters: fields.map(field => field.kind) };
  g.emitEither(
    [`class ${name} {`, [`ready = true;`, `constructor(public ${fields[0].name}: ${g.typeText(fields[0].kind)}, public ${fields[1].name}: ${g.typeText(fields[1].kind)}) {}`], `}`],
    [`class ${name} {`, [`${fields[0].name};`, `${fields[1].name};`, `ready = true;`, `constructor(a0, a1) {`, [`this.${fields[0].name} = a0;`, `this.${fields[1].name} = a1;`], `}`], `}`],
  );
  g.classes.push(model);
  const variable = g.fresh("o");
  g.emit(`const ${variable} = new ${name}(${g.argumentsFor(model.parameters, 1)});`, `print("${variable} " + ${g.keysOf(variable)});`, ...g.look(g.declare(variable, { is: "instance", of: model })));
  g.emit(`class ${heir} extends ${name} {`, [`more = ${g.int32(0)};`], `}`, `print("${heir} " + ${g.keysOf(`new ${heir}(${g.argumentsFor(model.parameters, 0)})`)});`);
}

/** Values of unknown type, told apart by typeof, instanceof, `in`, Array.isArray and functions that act as type guards. */
function typeGuards(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [klass, isPoint, tell] = [g.fresh("C"), g.fresh("isPoint"), g.fresh("classify")];
  g.emit(
    `class ${klass} {`,
    [`inner = ${g.int32(0)};`],
    `}`,
    `function ${isPoint}(value${a("unknown")})${a("value is { x: number; y: number }")} {`,
    [`return typeof value === "object" && value !== null && "x" in value && "y" in value;`],
    `}`,
    `function ${tell}(value${a("unknown")})${a("string")} {`,
    [
      `if (typeof value === "number") return "number " + (value + 1);`,
      `if (typeof value === "string") return "string " + value.length;`,
      `if (typeof value === "bigint") return "bigint " + (value + 1n);`,
      `if (typeof value === "function") return "function " + value.length;`,
      `if (value === null || value === undefined) return "nothing";`,
      `if (Array.isArray(value)) return "array " + value.length;`,
      `if (value instanceof ${klass}) return "instance " + value.inner;`,
      `if (${isPoint}(value)) return "point " + (value.x + value.y);`,
      `if (typeof value === "object" && "inner" in value) return "looks like one " + String(value.inner);`,
      `return typeof value;`,
    ],
    `}`,
  );
  const values = [g.int32(0), g.number(0), g.string(0), g.bigint(0), "null", "undefined", "[1, 2]", `new ${klass}()`, `{ x: ${g.int32(0)}, y: ${g.number(0)} }`, `{ inner: ${g.string(0)} }`, `Object.create(${klass}.prototype)`, "true", `Symbol("s")`, `(p${a("number")}) => p`, `new Proxy(new ${klass}(), {})`, `new Proxy([1], {})`, `{ x: 1 }`, `Object.create({ x: 1, y: 2 })`, klass];
  g.emit(`print("${tell} " + ${g.listing(`[${random.sample(values, random.between(5, 9)).join(", ")}]`, "value", `${tell}(value)`)});`);
}

/** An object of a base class is used as an heir, and the other way round. Any object passes a cast to an object type. */
function castsBetweenClasses(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [base, heir, other, read] = [g.fresh("Base"), g.fresh("Heir"), g.fresh("Other"), g.fresh("read")];
  g.emit(
    `class ${base} {`,
    [`id${a("number")} = ${g.int32(0)};`, `who()${a("string")} {`, [`return "base";`], `}`],
    `}`,
    `class ${heir} extends ${base} {`,
    [`more${a("string")} = ${g.string(0)};`, `who()${a("string")} {`, [`return "heir " + this.more;`], `}`],
    `}`,
    `class ${other} {`,
    [`more${a("string")} = ${g.string(0)};`, `id${a("number")} = ${g.int32(0)};`],
    `}`,
    `function ${read}(o${a(base)})${a("string")} {`,
    [`const heir = ${g.cast("o", heir)};`, `return o.id + ":" + String(heir.more) + ":" + (typeof o.who === "function" ? o.who() : "no method");`],
    `}`,
    `print("${read} " + ${read}(new ${base}()) + " " + ${read}(new ${heir}()) + " " + ${read}(${g.cast(`new ${other}()`, `unknown as ${base}`)}) + " " + ${read}(${g.cast(`{ id: ${g.int32(0)} }`, base)}) + " " + ${read}(Object.create(${heir}.prototype)));`,
  );
  if (random.chance(0.5)) g.emit(`print("${read} list " + ${g.listing(`${g.cast(`[new ${heir}(), new ${base}(), new ${heir}()]`, `${base}[]`)}`, "o", `${read}(o)`)});`);
}

/** Fields that may be missing. */
function optionalFields(g: Generator): void {
  const { random } = g;
  const [type, make, sum] = [g.fresh("Options"), g.fresh("makeOptions"), g.fresh("describe")];
  g.emitType(`type ${type} = { width?: number; title?: string; nested?: { deep?: number }; required: number };`);
  g.emit(
    `function ${make}(level${g.annotation("number")})${g.annotation(type)} {`,
    [`const made${g.annotation(type)} = { required: level };`, `if (level > 0) made.width = level * ${g.int32(0)};`, `if (level > 1) made.title = "t" + level;`, `if (level > 2) made.nested = level > 3 ? { deep: level } : {};`, `return made;`],
    `}`,
    `function ${sum}(o${g.annotation(type)})${g.annotation("string")} {`,
    [`return (o.width ?? -1) + "," + (o.title ?? "none") + "," + (o.nested?.deep ?? "shallow") + "," + o.required + "," + ("width" in o) + "," + ${g.keysOf("o")};`],
    `}`,
    `for (let level = 0; level < 5; level++) print("${sum} " + ${sum}(${make}(level)));`,
    `print("${sum} " + ${sum}({ required: 1, width: undefined }) + " " + ${sum}({ title: ${g.string(0)}, required: ${g.int32(0)} }) + " " + ${sum}({ ...${make}(4), ${random.pick(["width: undefined", "nested: undefined", "required: 0"])} }));`,
  );
}

/** Objects of one class or factory get their fields on different paths: in branches, by helpers, by Object.assign, under computed keys. */
function constructionPaths(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [name, fill, tell] = [g.fresh("C"), g.fresh("fill"), g.fresh("tell")];
  const self = g.cast("this");
  const paths = random.sample<Code[]>(
    [
      [`if (mode & 1) ${self}.a = mode;`, `${self}.b = "b" + mode;`, `if (!(mode & 1)) ${self}.a = -mode;`],
      [`${fill}(this, mode);`],
      [`Object.assign(this, mode > 1 ? { a: mode, b: "assigned" } : { b: "assigned", a: mode });`],
      [`for (const key of mode > 1 ? ["a", "b"] : ["b", "a", "c"]) ${self}[key] = key + mode;`],
      [`${self}[mode > 1 ? "a" : "b"] = mode;`, `${self}[mode > 1 ? "b" : "a"] = mode + 0.5;`],
      [`if (mode === 2) return;`, `${self}.a = mode;`, `${self}.b = mode;`],
      [`${self}.a = mode;`, `if (mode === 3) delete ${self}.a;`, `${self}.b = mode;`, `if (mode === 3) ${self}.a = "again";`],
      [`Object.defineProperty(this, "a", { value: mode, enumerable: mode !== 1, writable: true, configurable: true });`, `${self}.b = mode;`],
      [`({ a: ${self}.a, b: ${self}.b = "default" } = mode > 1 ? { a: mode } : { a: 0, b: mode });`],
      [`try {`, [`${self}.a = mode;`, `if (mode === 1) throw new Error("own path");`, `${self}.b = mode;`], `} catch {`, [`${self}.c = "caught";`], `}`],
    ],
    random.between(1, 2),
  ).flat();
  g.emit(
    `function ${fill}(o${a("any")}, mode${a("number")})${a("void")} {`,
    [`o.b = mode * 2;`, `if (mode > 1) o.a = "filled";`],
    `}`,
    `class ${name} {`,
    [...(random.chance(0.4) ? [`first = 1;`] : []), `constructor(mode${a("number")}) {`, paths, `}`],
    `}`,
    `function ${tell}(o${a("any")})${a("string")} {`,
    [`return String(o.a) + "," + String(o.b) + "," + String(o.c) + " " + ${g.keysOf("o")};`],
    `}`,
    `for (let mode = 0; mode < 4; mode++) print("${name} " + mode + " " + ${tell}(new ${name}(mode)));`,
  );
}

/** Places that look as if they always held a value, and the ways `undefined` and `null` get into them. */
function nullishSources(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [orElse, holder] = [g.fresh("orElse"), g.fresh("source")];
  g.emit(
    `function ${orElse}(value${a("unknown")})${a("string")} {`,
    [`return (value ?? "default") + ":" + (value == null) + ":" + (value === undefined) + ":" + typeof value + ":" + String(${g.cast("value")}?.length);`],
    `}`,
    `const ${holder} = { list: [${g.int32(0)}, ${g.int32(0)}], table: new Map([[1, "one"]]), text: ${g.string(0)}, nothing() {}, get missing() { return; } };`,
  );
  const loose = g.cast(holder);
  const sources = [
    `${holder}.list[${random.pick(["0", "2", "-1", "9"])}]`,
    `${holder}.list.pop()`,
    `${holder}.list.shift()`,
    `[1, , 3][1]`,
    `${holder}.table.get(${random.pick(["1", "2"])})`,
    `${holder}.text.match(/zzz/)`,
    `/(a)|(b)/.exec("b")${g.typed ? "!" : ""}[1]`,
    `${holder}.nothing()`,
    `${holder}.missing`,
    `${loose}.absent`,
    `${loose}.absent?.deeper`,
    `void ${g.int32(0)}`,
    `((p${g.typed ? "?: number" : ""}) => p)()`,
    `(([p]${a("number[]")}) => p)([])`,
    `(({ p = null }${a("{ p?: null }")}) => p)({})`,
    `JSON.parse("null")`,
    `JSON.parse('{"a":null}').a`,
    `Object.getPrototypeOf(Object.prototype)`,
    `${holder}.text.at(99)`,
    `${holder}.text[99]`,
    `Object.getOwnPropertyDescriptor(${holder}, "absent")`,
    `(() => { let later; return later; })()`,
    `(function (${g.typed ? "this: unknown" : ""}) { return this; })()`,
    `new Array(2)[0]`,
    `${holder}.list.length`,
    `${holder}.text`,
    `Symbol().description`,
    `(() => { try { return ${loose}.absent.deeper; } catch { return null; } })()`,
  ];
  const label = g.fresh("nullish");
  g.emit(...random.sample(sources, random.between(4, 7)).map((source, i) => `print("${label}${i} " + ${orElse}(${source}));`));
}

/** Variables whose first store may be skipped or come after the first read. */
function initializationPaths(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  g.need("errorName");
  const pieces: (() => Code[])[] = [
    () => {
      const name = g.fresh("skipped");
      return [
        `function ${name}(fail${a("boolean")})${a("string")} {`,
        [`let value${a("number | undefined")};`, `try {`, [`if (fail) throw new Error("own skip");`, `value = ${g.int32(0)};`], `} catch {}`, `return typeof value + ":" + value;`],
        `}`,
        `print("${name} " + ${name}(false) + " " + ${name}(true));`,
      ];
    },
    () => {
      const name = g.fresh("previous");
      return [
        `function ${name}(turns${a("number")})${a("string")} {`,
        [`let seen = "";`, `for (let i = 0; i < turns; i++) {`, [`var last${a("number | undefined")};`, `seen += String(last) + ",";`, `last = i * ${g.int32(0)};`], `}`, `return seen;`],
        `}`,
        `print("${name} " + ${name}(3) + " " + ${name}(0) + " " + ${name}(1));`,
      ];
    },
    () => {
      const name = g.fresh("jumped");
      return [
        `function ${name}(which${a("number")})${a("string")} {`,
        [
          `switch (which) {`,
          [`case 0:`, [`var chosen${a("string | undefined")} = "zero";`], `case 1:`, [`return which + ":" + chosen;`], `default:`, [`chosen = chosen ?? "late";`, `return which + ":" + chosen;`]],
          `}`,
        ],
        `}`,
        `print("${name} " + ${name}(0) + " " + ${name}(1) + " " + ${name}(2));`,
      ];
    },
    () => {
      const [name, read] = [g.fresh("early"), g.fresh("readEarly")];
      return [
        `function ${read}()${a("string")} {`,
        [`return typeof ${name} + ":" + String(${name});`],
        `}`,
        `print("${name} " + ${read}());`,
        `var ${name}${a("number | undefined")} = ${g.int32(0)};`,
        `print("${name} " + ${read}());`,
      ];
    },
    () => {
      const name = g.fresh("Statics");
      return [
        `class ${name} {`,
        [`static first = ${g.int32(0)};`, `static second = ${name}.first + 1;`, `static third${a("string")} = String(${g.cast(name)}.fourth) + ${name}.second;`, `static fourth = "late";`, `static {`, [`${name}.first = ${name}.second * 2;`], `}`],
        `}`,
        `print("${name} " + ${name}.first + " " + ${name}.second + " " + ${name}.third + " " + ${name}.fourth + " " + Object.keys(${name}).join());`,
      ];
    },
    () => {
      const name = g.fresh("Fields");
      return [
        `class ${name} {`,
        [`a${a("number")} = ${g.int32(0)};`, `b${a("string")} = String(${g.cast("this")}.c) + this.a;`, `c${a("number")} = this.a + 1;`, `d = () => this.c;`],
        `}`,
        `print("${name} " + new ${name}().b + " " + new ${name}().c + " " + new ${name}().d());`,
      ];
    },
    () => {
      const name = g.fresh("zone");
      return [
        `function ${name}(early${a("boolean")})${a("string")} {`,
        [`const read = () => inner;`, `if (early) {`, [`try {`, [`return "read " + read();`], `} catch (error) {`, [`return errorName(error);`], `}`], `}`, `const inner = ${g.int32(0)};`, `return "late " + read();`],
        `}`,
        `print("${name} " + ${name}(true) + " " + ${name}(false));`,
      ];
    },
  ];
  g.emitSome(pieces, random.between(2, 3));
}

/** A test narrows a place, something changes the place, and the narrowed use follows. */
function brokenNarrowing(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [state, change, use] = [g.fresh("state"), g.fresh("change"), g.fresh("use")];
  const other = random.pick(['"text"', "undefined", "null", "0.5", "{ n: 1 }", "[3]", "true"]);
  const place = random.pick([`${state}.value`, `${state}.list[0]`, `${state}.inner.value`]);
  const test = random.pick([`typeof ${place} === "number"`, `${place} !== undefined`, `${place} != null`, `Number.isInteger(${place})`, `${place} === 1`, `${place} > 0`, `${place}`]);
  const trigger = random.pick([`${change}();`, `void \`\${{ toString: ${change} }}\`;`, `void ${state}.poke;`, `[0].indexOf(${g.cast(`{ valueOf: ${change} }`)}, ${g.cast(`{ valueOf: ${change} }`)});`, `"a".replace("a", ${change});`, `void (${g.cast(`{ valueOf: ${change} }`)} + 1);`]);
  g.emit(
    `const ${state}${a("any")} = { value: 1, list: [1, 2], inner: { value: 1 }, get poke() { return ${change}(); } };`,
    `let ${state}Armed = false;`,
    `function ${change}()${a("string")} {`,
    [`if (${state}Armed) ${place} = ${other};`, `return "";`],
    `}`,
    `function ${use}()${a("string")} {`,
    [`if (${test}) {`, [trigger, `return "narrowed " + (${place} + 1) + " " + typeof ${place};`], `}`, `return "other " + String(${place});`],
    `}`,
    `print("${use} " + ${use}() + " " + ${use}());`,
    `${state}Armed = true;`,
    `print("${use} " + ${use}() + " " + ${use}());`,
  );
}

/** A function that gives one kind of result nearly always, and another on a rare path that is taken late. */
function rareResults(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [f, total] = [g.fresh("mostly"), g.fresh("total")];
  const rare = random.pick(['"seven"', "undefined", "null", "0.5", "NaN", "-0", "2147483648", "{ valueOf: () => 7 }", "[7]", "7n", "true"]);
  const shape = random.pick<[string, string]>([
    [`function ${f}(n${a("number")})${a("any")} {`, `}`],
    [`const ${f} = (n${a("number")})${a("any")} => {`, `};`],
  ]);
  const limit = random.pick([8, 20]);
  g.need("errorName");
  g.emit(
    shape[0],
    [random.pick([`if (n === 7) return ${rare};`, `if (n > 6 && n < 8) return ${rare};`, `switch (n) {\0`]).replace("switch (n) {\0", `if (String(n) === "7") return ${rare};`), `return n ${random.pick(["+ 1", "* 2", "| 0", "& 3"])};`],
    shape[1],
    `let ${total}${a("any")} = 0;`,
    `try {`,
    [`for (let i = 0; i < ${limit}; i++) ${total} ${random.pick(["+=", "-=", "="])} ${f}(i)${random.pick(["", " * 1", " + 0"])};`],
    `} catch (error) {`,
    [`print("${total} " + errorName(error));`],
    `}`,
    `print("${total} " + typeof ${total} + " " + String(${total}) + " " + typeof ${f}(7) + " " + typeof ${f}(1));`,
  );
}

/** Short-lived objects in a loop, one of which gets out on a rare turn and is changed from outside while the loop still uses it. */
function virtualObjects(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [walk, kept] = [g.fresh("walk"), g.fresh("kept")];
  const make = random.pick([`{ x: i, y: i * 2 }`, `[i, i * 2]`, `new ${walk}Point(i, i * 2)`, `{ x: i, y: i * 2, inner: { z: i } }`, `Object.assign({}, { x: i, y: i * 2 })`]);
  const isArray = make.startsWith("[");
  const [x, y] = isArray ? ["[0]", "[1]"] : [".x", ".y"];
  const escape = random.pick([`${kept}.push(point);`, `${kept}[0] = point;`, `${kept}.length = 0; ${kept}.push(point);`, `(() => ${kept}.push(point))();`, `${kept}.push(previous ?? point);`]);
  g.emit(
    `const ${kept}${a("any[]")} = [];`,
    `class ${walk}Point {`,
    [`x${a("number")};`, `y${a("number")};`, `constructor(x${a("number")}, y${a("number")}) {`, [`this.x = x;`, `this.y = y;`], `}`],
    `}`,
    `function ${walk}(turns${a("number")}, rare${a("number")})${a("string")} {`,
    [
      `let sum = 0;`,
      `let previous${a("any")} = null;`,
      `let same = 0;`,
      `for (let i = 0; i < turns; i++) {`,
      [
        `const point${a("any")} = ${make};`,
        `if (i === rare) ${escape}`,
        `if (${kept}.length > 0) ${kept}[${kept}.length - 1]${x} += 100;`,
        `sum += point${x} + point${y};`,
        `if (previous === point) same++;`,
        `previous = ${random.pick(["point", "i & 1 ? point : previous", "null"])};`,
      ],
      `}`,
      `return sum + " " + same + " " + (previous === null ? "none" : previous${x});`,
    ],
    `}`,
    `print("${walk} " + ${walk}(${random.pick([4, 10])}, -1) + " | " + ${walk}(${random.pick([4, 10])}, ${random.below(4)}) + " | " + ${kept}.length + " " + JSON.stringify(${kept}[0]));`,
  );
}

/** Multiplications, shifts and conversions whose exact results need more than 32 or 53 bits. */
function wideArithmetic(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const f = g.fresh("wide");
  const operands = ["2147483647", "-2147483648", "65536", "65535", "4294967295", "46341", "1073741824", "-1", "3", "0", "9007199254740991", "0.1", "1e10", "-0"];
  const forms = random.sample(
    [`(a * b) | 0`, `Math.imul(a, b)`, `a * b`, `(a * b) % 1000`, `(a + b) | 0`, `(a + b) >>> 0`, `a << b`, `a >> b`, `a >>> b`, `(a | 0) + (b | 0)`, `a / b`, `(a / b) | 0`, `Math.floor(a / b)`, `a % b`, `~~(a * b)`, `(a - b) | 0`, `a ** 2`, `(a * a * a) | 0`, `-a | 0`, `Math.trunc(a * b)`, `a & b`, `a ^ b`, `(a >>> 0) * (b >>> 0)`, `Math.round(a * 0.5)`, `(a | 0) === a`, `a + b === b + a + 0`, `Number.isSafeInteger(a * b)`],
    random.between(4, 8),
  );
  g.emit(
    `function ${f}(a${a("number")}, b${a("number")})${a("string")} {`,
    [`const results = [${forms.join(", ")}];`, `let text = "";`, `for (const result of results) text += (Object.is(result, -0) ? "-0" : String(result)) + ",";`, `return text;`],
    `}`,
    `for (let i = 0; i < 3; i++) mix(${f}(i, i + 1).length);`,
    ...Array.from({ length: random.between(2, 4) }, () => `print("${f} " + ${f}(${random.pick(operands)}, ${random.pick(operands)}));`),
  );
  g.need("mix");
}

/** `new C()` where `C` is a variable that another function stores a different class into. */
function constructorChanges(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [first, second, current, next, order] = [g.fresh("First"), g.fresh("Second"), g.fresh("Current"), g.fresh("next"), g.fresh("order")];
  const base = random.pick(["", "", " extends Map", " extends Array", " extends Error"]);
  g.emit(
    `class ${first}${base} {`,
    [`kept${a("number")} = ${g.int32(0)};`, `tag()${a("string")} {`, [`return "first";`], `}`],
    `}`,
    `class ${second} extends ${first} {`,
    [`more${a("string")} = ${g.string(0)};`, `tag()${a("string")} {`, [`return "second " + super.tag();`], `}`],
    `}`,
    `let ${current}${a(`typeof ${first}`)} = ${first};`,
    `function ${next}()${a("void")} {`,
    [`${current} = ${current} === ${first} ? ${second} : ${first};`],
    `}`,
    `const ${order}${a("string[]")} = [];`,
    `for (let i = 0; i < ${random.between(3, 5)}; i++) {`,
    [`const made = new ${current}();`, `${order}.push(made.tag() + ":" + made.kept + ":" + (made instanceof ${second}) + ":" + ${g.keysOf("made")});`, ...g.indirectly([`${next}();`])],
    `}`,
    `print("${order} " + ${order}.join(" | "));`,
  );
}

/** Rows of a table that hold closures, taken apart by destructuring and called several times. */
function closureTables(g: Generator): void {
  const { random } = g;
  const [subjects, narrow, out] = [g.fresh("subjects"), g.fresh("narrow"), g.fresh("out")];
  g.emit(
    `let ${narrow} = ${g.string(0)};`,
    `const ${subjects}${g.annotation("[string, () => string][]")} = [["flat", () => ${narrow}], ["other", () => ${narrow} + "x"], ["empty", () => ""], ["changing", () => (${narrow} += "!")]];`,
    `let ${out} = "";`,
    `for (const [name, subject] of ${subjects}) {`,
    [`${out} += name + ":" + subject() + subject().length + (subject() === subject()) + ";";`, `${out} += [subject(), subject()].join("+") + (subject() + subject()).length + ";";`],
    `}`,
    `print("${out} " + ${out});`,
  );
  if (random.chance(0.5)) g.emit(...g.indirectly([`${subjects}[${random.below(4)}][1] = () => "replaced";`]), `print("${subjects} " + ${g.listing(subjects, "[name, subject]", "name + subject()")});`);
}

/** Members with names that mean something elsewhere: `constructor`, `name`, `length`, `prototype`, `then`, `__proto__`. */
function oddMemberNames(g: Generator): void {
  const { random } = g;
  const name = g.fresh("Odd");
  const pieces: (() => Code[])[] = [
    () => [
      `class ${name}A {`,
      [`static *${g.typed ? `["constructor"]` : "constructor"}() {`, [`yield 1;`, `yield 2;`], `}`, `static name() {`, [`return "own name";`], `}`, `["constructor"]() {`, [`return "method";`], `}`],
      `}`,
      `let ${name}Text = "";`,
      `for (const value of ${g.cast(`${name}A`)}.constructor()) ${name}Text += value;`,
      `print("${name}A " + ${name}Text + " " + typeof ${name}A.name + " " + ${g.cast(`new ${name}A()`)}.constructor() + " " + Object.getOwnPropertyNames(${name}A).join());`,
    ],
    () => [
      `const ${name}B${g.annotation("any")} = { __proto__: null, ["__pro" + "to__"]: 1, constructor: 2, length: 3, prototype: 4, then: undefined, toString: 5 };`,
      `print("${name}B " + Object.keys(${name}B).join() + " " + Object.getPrototypeOf(${name}B) + " " + ${name}B.__proto__ + " " + ${name}B.length + " " + (await ${name}B === ${name}B));`,
    ],
    () => [
      `class ${name}C {`,
      [`static length = ${g.int32(0)};`, `static prototype2 = 1;`, `length = ${g.int32(0)};`, `then${g.annotation("unknown")} = undefined;`, `0 = "zero";`, `"a b" = 1;`, `[${g.typed ? `"computed"` : g.computedKey("computed")}] = 2;`],
      `}`,
      `print("${name}C " + ${name}C.length + " " + Object.keys(new ${name}C()).join("|") + " " + ${g.cast(`new ${name}C()`)}.computed + " " + Array.prototype.slice.apply(new ${name}C()).length);`,
    ],
    () => [
      `function ${name}D(${g.typed ? "this: any" : ""}) {`,
      [`this.constructor = "shadowed";`, `this.prototype = 1;`, `this.hasOwnProperty = () => "own";`],
      `}`,
      `print("${name}D " + new ${g.cast(`${name}D`)}().constructor + " " + new ${g.cast(`${name}D`)}().hasOwnProperty("x") + " " + (new ${g.cast(`${name}D`)}() instanceof ${name}D) + " " + (${name}D.prototype.constructor === ${name}D));`,
    ],
  ];
  g.emitSome(pieces, random.between(1, 2));
}

/** Arrays that have own properties from birth: results of matches, the strings of a template, `arguments`. */
function bornWithProperties(g: Generator): void {
  const { random } = g;
  const label = g.fresh("born");
  const source = random.pick<[string, string]>([
    [`${g.cast(`/(\\d)(x)?/.exec("a1b2")`)}`, "index"],
    [`${g.cast(`"a1b2".match(/(?<digit>\\d)/)`)}`, "groups"],
    [`${g.cast(`"a1b2".match(/\\d/g)`)}`, "index"],
    [`${g.cast(`((strings${g.annotation("TemplateStringsArray")}, ..._${g.annotation("unknown[]")}) => strings)\`a\${1}b\${2}c\``)}`, "raw"],
    [`Object.assign([1, 2], { label: "own" })`, "label"],
    [`${g.cast(`"x,y".split(",")`)}`, "length"],
  ]);
  g.emit(
    `const ${label} = ${source[0]};`,
    `let ${label}Text = "";`,
    `for (const part of ${label}) ${label}Text += String(part) + ";";`,
    `for (const key in ${label}) ${label}Text += key + ",";`,
    `const [${label}First, ...${label}Rest] = ${label};`,
    `print("${label} " + ${label}Text + " " + ${label}.length + " " + typeof ${label}.${source[1]} + " " + String(${label}First) + ${label}Rest.length + " " + ${label}.slice().length + " " + ${label}.concat([1]).length + " " + Array.isArray(${label}) + " " + ${label}.join("-"));`,
  );
}

const foundations: Step[] = [
  { name: "classes", weight: 5, run: classes },
  { name: "records", weight: 4, run: records },
  { name: "constructor-functions", weight: 2, run: constructorFunctions },
  { name: "arrays", weight: 2, run: arrays },
  { name: "escaping-this", weight: 1, run: escapingThis },
];

const features: Step[] = [
  { name: "classes", weight: 5, run: classes },
  { name: "records", weight: 4, run: records },
  { name: "functions", weight: 10, run: functions },
  { name: "closures", weight: 4, run: closures },
  { name: "arrays", weight: 4, run: arrays },
  { name: "collections", weight: 4, run: collections },
  { name: "readers", weight: 4, run: readers },
  { name: "constructor-functions", weight: 3, run: constructorFunctions },
  { name: "builtin-subclasses", weight: 3, run: builtinSubclasses, alone: true },
  { name: "generators", weight: 3, run: generators, alone: true },
  { name: "async-order", weight: 3, run: asyncOrder, alone: true },
  { name: "destructuring", weight: 5, run: destructuring },
  { name: "spreads", weight: 2, run: spreads },
  { name: "optional-chains", weight: 2, run: optionalChains },
  { name: "finally-flow", weight: 2, run: finallyFlow, alone: true },
  { name: "symbols", weight: 3, run: symbols, alone: true },
  { name: "tagged-templates", weight: 1, run: taggedTemplates, alone: true },
  { name: "arguments-objects", weight: 2, run: argumentsObjects, alone: true },
  { name: "parameters", weight: 2, run: parameters, alone: true },
  { name: "object-functions", weight: 4, run: objectFunctions },
  { name: "proxies", weight: 5, run: proxies },
  { name: "json", weight: 4, run: json },
  { name: "typed-arrays", weight: 2, run: typedArrays, alone: true },
  { name: "string-loops", weight: 2, run: stringLoops },
  { name: "weak-collections", weight: 1, run: weakCollections },
  { name: "collection-iteration", weight: 2, run: collectionIteration, alone: true },
  { name: "escaping-this", weight: 3, run: escapingThis, alone: true },
  { name: "early-virtual-call", weight: 2, run: earlyVirtualCall, alone: true },
  { name: "constructor-returns-other", weight: 2, run: constructorReturnsOther, alone: true },
  { name: "half-built", weight: 2, run: halfBuilt, alone: true },
  { name: "new-targets", weight: 1, run: newTargets, alone: true },
  { name: "foreign-new-target", weight: 8, run: foreignNewTarget, alone: true },
  { name: "class-factories", weight: 3, run: classFactories, alone: true },
  { name: "function-names", weight: 1, run: functionNames, alone: true },
  { name: "method-callers", weight: 3, run: methodCallers, alone: true },
  { name: "accessor-forms", weight: 3, run: accessorForms, alone: true },
  { name: "defined-names", weight: 3, run: definedNames, alone: true },
  { name: "bind-chains", weight: 2, run: bindChains, alone: true },
  { name: "shape-unions", weight: 2, run: shapeUnions, alone: true },
  { name: "execution-order", weight: 1, run: executionOrder, alone: true },
  { name: "computed-function-keys", weight: 2, run: computedFunctionKeys, alone: true },
  { name: "function-bases", weight: 2, run: functionBases, alone: true },
  { name: "discriminated-unions", weight: 3, run: discriminatedUnions, alone: true },
  { name: "generics", weight: 2, run: generics, alone: true },
  { name: "enums", weight: 2, run: enums, alone: true },
  { name: "interfaces", weight: 3, run: interfaces, alone: true },
  { name: "tuples", weight: 2, run: tuples, alone: true },
  { name: "dictionaries", weight: 3, run: dictionaries, alone: true },
  { name: "parameter-properties", weight: 2, run: parameterProperties },
  { name: "type-guards", weight: 2, run: typeGuards, alone: true },
  { name: "casts-between-classes", weight: 2, run: castsBetweenClasses, alone: true },
  { name: "optional-fields", weight: 3, run: optionalFields, alone: true },
  { name: "construction-paths", weight: 4, run: constructionPaths, alone: true },
  { name: "nullish-sources", weight: 3, run: nullishSources, alone: true },
  { name: "initialization-paths", weight: 3, run: initializationPaths, alone: true },
  { name: "broken-narrowing", weight: 4, run: brokenNarrowing, alone: true },
  { name: "rare-results", weight: 3, run: rareResults, alone: true },
  { name: "virtual-objects", weight: 4, run: virtualObjects, alone: true },
  { name: "wide-arithmetic", weight: 3, run: wideArithmetic, alone: true },
  { name: "constructor-changes", weight: 3, run: constructorChanges, alone: true },
  { name: "closure-tables", weight: 2, run: closureTables, alone: true },
  { name: "odd-member-names", weight: 2, run: oddMemberNames, alone: true },
  { name: "born-with-properties", weight: 2, run: bornWithProperties, alone: true },
  { name: "private-members", weight: 2, run: privateMembers, alone: true },
  { name: "super-changes", weight: 2, run: superChanges, alone: true },
  { name: "runs-again", weight: 3, run: runsAgain, alone: true },
  { name: "local-escapes", weight: 3, run: localEscapes, alone: true },
  { name: "ranges", weight: 3, run: ranges, alone: true },
  { name: "engine-errors", weight: 2, run: engineErrors },
  { name: "partial-updates", weight: 3, run: partialUpdates, alone: true },
  { name: "hoisting", weight: 2, run: hoisting, alone: true },
  { name: "callee-changes", weight: 3, run: calleeChanges, alone: true },
  { name: "captured-variables", weight: 3, run: capturedVariables, alone: true },
];

// Attacks. Each returns false when nothing in scope can be its victim.

/** Runs the statements through an indirection, then looks at the victim again. */
function strike(g: Generator, victim: Variable, statements: Code[]): void {
  g.emit(...g.indirectly(statements));
  g.emit(...g.lookCarefully(victim));
  for (const reader of g.readers) {
    if (reader.fields.every(field => fieldsOf(victim.kind).some(candidate => candidate.name === field.name))) {
      g.emit(...g.attempt([`"${reader.name} again " + ${reader.name}(${victim.name})`]));
    }
  }
}

function holderWith(g: Generator, accept: (kind: Kind) => boolean): { victim: Variable; field: Field } | undefined {
  const found = g.variables(kind => fieldsOf(kind).some(field => accept(field.kind)));
  if (found.length === 0) return undefined;
  const victim = g.random.pick(found);
  return { victim, field: g.random.pick(fieldsOf(victim.kind).filter(field => accept(field.kind))) };
}

/** `victim.field` or `victim[<computed key>]`, as the target of a store. */
function member(g: Generator, victim: string, field: string): string {
  return g.random.chance(0.5) ? `${victim}.${field}` : `${g.cast(victim)}[${g.computedKey(field)}]`;
}

/** One of the many ways to give a property a value. The value has to fit the static type of the field. */
function storeThrough(g: Generator, victim: string, field: string, value: string): Code[] {
  const key = g.computedKey(field);
  const loose = g.cast(victim);
  const data = `{ value: ${value}, writable: true, enumerable: true, configurable: true }`;
  return g.random.weighted<Code[]>([
    [4, [`${victim}.${field} = ${value};`]],
    [4, [`${loose}[${key}] = ${value};`]],
    [2, [`Reflect.set(${victim}, ${key}, ${value});`]],
    [2, [`Object.assign(${victim}, { ${field}: ${value} });`]],
    [1, [`Object.assign(${victim}, { [${key}]: ${value} });`]],
    [2, [`Object.defineProperty(${victim}, ${key}, ${data});`]],
    [1, [`Object.defineProperties(${victim}, { ${field}: ${data} });`]],
    [1, [`Reflect.defineProperty(${victim}, ${key}, ${data});`]],
    [1, [`${g.cast("({}).constructor")}.defineProperty(${victim}, ${key}, ${data});`]],
    [1, [`${g.cast("({}).constructor")}.assign(${victim}, { ${field}: ${value} });`]],
    [1, [`({ from: ${victim}.${field} } = { from: ${value} });`]],
    [1, [`[${victim}.${field}] = [${value}];`]],
    [1, [`for (${victim}.${field} of [${value}]);`]],
    [1, [`for (const [key, item] of Object.entries({ ${field}: ${value} })) ${loose}[key] = item;`]],
    [1, [`for (const key in { ${field}: 0 }) ${loose}[key] = ${value};`]],
    [1, [`Reflect.set({}, ${key}, ${value}, ${victim});`]],
    [1, [`${g.cast(`new Proxy(${victim}, {})`)}[${key}] = ${value};`]],
    [1, [`${g.cast(`Object.create(new Proxy({}, { set: (target, key, item) => Reflect.set(${victim}, key, item) }))`)}[${key}] = ${value};`]],
  ]);
}

function storeOtherKind(g: Generator): boolean {
  const found = holderWith(g, kind => kind.is === "mixed");
  if (!found) return false;
  strike(g, found.victim, storeThrough(g, found.victim.name, found.field.name, g.random.pick(otherValues)));
  return true;
}

function storeOtherKindInStatic(g: Generator): void {
  const { random } = g;
  const [name, read] = [g.fresh("Counter"), g.fresh("readCount")];
  g.need("mix");
  g.emit(
    `class ${name} {`,
    [`static count${g.annotation("any")} = ${g.int32(0)};`, `static bump() {`, [`return ${name}.count++;`], `}`],
    `}`,
    `function ${read}()${g.annotation("string")} {`,
    [`return typeof ${name}.count + ":" + String(${name}.count);`],
    `}`,
    `for (let i = 0; i < 3; i++) mix(${name}.bump());`,
    `print("${read} " + ${read}());`,
    ...g.indirectly(storeThrough(g, name, "count", random.pick(otherValues))),
    `print("${read} " + ${read}() + " " + String(${name}.bump()) + " " + ${read}());`,
  );
}

function storeOtherKindInVariable(g: Generator): boolean {
  const found = g.visible().filter(variable => variable.mutable && variable.kind.is === "mixed");
  if (found.length === 0) return false;
  const victim = g.random.pick(found);
  strike(g, victim, [g.random.pick([`${victim.name} = ${g.random.pick(otherValues)};`, `[${victim.name}] = [${g.random.pick(otherValues)}];`, `({ a: ${victim.name} } = { a: ${g.random.pick(otherValues)} });`])]);
  return true;
}

function leaveInt32Range(g: Generator): boolean {
  const found = holderWith(g, kind => kind.is === "int32");
  if (!found) return false;
  const { victim, field } = found;
  const statements = g.random.chance(0.6)
    ? storeThrough(g, victim.name, field.name, g.random.pick(outOfRange))
    : [`${member(g, victim.name, field.name)} ${g.random.pick(["/= 2", "+= 2147483647", "*= 65536", "*= -0", "%= 0", "**= 40", "-= 0.5", ">>>= 0"])};`];
  strike(g, victim, statements);
  return true;
}

function addProperty(g: Generator): boolean {
  const victim = g.variable(kind => fieldsOf(kind).length > 0);
  if (!victim) return false;
  const key = g.random.pick(["extra", "0", "z", "toString2", "-1", "1e3", "a b"]);
  const value = g.expression(g.someKind(true), 1);
  const loose = g.cast(victim.name);
  strike(
    g,
    victim,
    g.random.weighted<Code[]>([
      [4, [`${loose}[${g.computedKey(key)}] = ${value};`]],
      [1, [`Object.assign(${victim.name}, { [${g.computedKey(key)}]: ${value} });`]],
      [1, [`Object.defineProperty(${victim.name}, ${g.computedKey(key)}, { value: ${value}, enumerable: ${g.random.chance(0.5)}, configurable: true });`]],
      [1, [`${loose}[Symbol.for("added")] = ${value};`]],
    ]),
  );
  g.emit(`print("${g.fresh("keys")} " + ${g.listing(`Reflect.ownKeys(${victim.name})`)});`);
  return true;
}

function deleteProperty(g: Generator): boolean {
  const found = holderWith(g, survivesUndefined);
  if (!found) return false;
  const { victim, field } = found;
  const target = g.random.chance(0.5) ? `${g.cast(victim.name)}.${field.name}` : `${g.cast(victim.name)}[${g.computedKey(field.name)}]`;
  const statements: Code[] = [g.random.chance(0.7) ? `delete ${target};` : `Reflect.deleteProperty(${victim.name}, ${g.computedKey(field.name)});`];
  if (g.random.chance(0.4)) statements.push(`${victim.name}.${field.name} = ${g.expression(field.kind, 1)};`);
  strike(g, victim, statements);
  g.emit(`print("${g.fresh("keys")} " + ${g.keysOf(victim.name)} + " " + ("${field.name}" in ${victim.name}));`);
  return true;
}

/** A data property becomes an accessor, whose getter may change a neighbor. */
function redefineAsAccessor(g: Generator): boolean {
  const found = holderWith(g, kind => ["int32", "number", "string", "boolean", "mixed"].includes(kind.is));
  if (!found) return false;
  const { victim, field } = found;
  const reads = g.fresh("reads");
  const kept = g.fresh("kept");
  const neighbor = g.random.pick(fieldsOf(victim.kind).filter(candidate => candidate !== field && ["int32", "number"].includes(candidate.kind.is)).concat(field));
  g.emit(`let ${reads} = 0;`, `let ${kept}${g.annotation(field.kind)} = ${g.expression(field.kind, 1)};`);
  strike(g, victim, [
    `Object.defineProperty(${victim.name}, ${g.computedKey(field.name)}, {`,
    [
      `get() {`,
      [`${reads}++;`, ...(neighbor !== field && g.random.chance(0.6) ? [`${victim.name}.${neighbor.name}++;`] : []), `return ${kept};`],
      `},`,
      `set(value${g.annotation(field.kind)}) {`,
      [`${kept} = value;`],
      `},`,
      `enumerable: ${g.random.chance(0.7)},`,
      `configurable: true,`,
    ],
    `});`,
  ]);
  g.emit(`print("${reads} " + ${reads});`);
  return true;
}

/** An accessor on the prototype catches reads and stores of a name the instances do not have, or no longer have. */
function accessorOnPrototype(g: Generator): boolean {
  const victim = g.variable(kind => kind.is === "instance");
  if (!victim || victim.kind.is !== "instance") return false;
  const { random } = g;
  const model = victim.kind.of;
  const own = fieldsOf(victim.kind).filter(field => survivesUndefined(field.kind));
  const field = own.length > 0 && random.chance(0.6) ? random.pick(own) : undefined;
  const name = field?.name ?? "extra";
  const caught = g.fresh("caught");
  g.emit(`const ${caught}${g.annotation("string[]")} = [];`);
  g.emit(
    ...g.indirectly([
      `Object.defineProperty(${g.prototypeOf(model)}, ${g.computedKey(name)}, {`,
      [`get() {`, [`${caught}.push("get");`, `return ${g.literal(field?.kind ?? int32)};`], `},`, `set(value) {`, [`${caught}.push("set " + String(value));`], `},`, `configurable: true,`],
      `});`,
      ...(field ? [`delete ${g.cast(victim.name)}.${name};`] : []),
    ]),
    `${g.cast(victim.name)}.${name} = ${field ? g.expression(field.kind, 1) : g.int32(1)};`,
    `print("${caught} " + String(${g.cast(victim.name)}.${name}) + " " + ${g.keysOf(victim.name)} + " " + ${caught}.join());`,
    ...g.lookCarefully(victim),
    `delete ${g.cast(g.prototypeOf(model))}.${name};`,
  );
  if (field) g.emit(`${victim.name}.${name} = ${g.expression(field.kind, 1)};`);
  return true;
}

function makeReadOnly(g: Generator): boolean {
  const victim = g.variable(kind => fieldsOf(kind).length > 0 || kind.is === "array");
  if (!victim) return false;
  const how = g.random.pick(["freeze", "seal", "preventExtensions"]);
  g.retire(victim);
  const store =
    victim.kind.is === "array"
      ? `${victim.name}.push(${g.expression(victim.kind.element, 0)});`
      : `${victim.name}.${g.random.pick(fieldsOf(victim.kind)).name} = ${g.cast("undefined")};`;
  strike(g, victim, [g.random.pick([`Object.${how}(${victim.name});`, `Object.${how}(${victim.name});`, `Object.${how}(new Proxy(${victim.name}, {}));`, `${g.cast("({}).constructor")}.${how}(${victim.name});`])]);
  g.emit(...g.guarded([store, `print("${g.fresh("stored")}");`]));
  g.emit(...g.guarded([`${g.cast(victim.name)}.extra = 1;`, `print("${g.fresh("extended")}");`]));
  g.emit(...g.lookCarefully(victim));
  g.emit(`print("${g.fresh("state")} " + Object.isFrozen(${victim.name}) + Object.isSealed(${victim.name}) + Object.isExtensible(${victim.name}));`);
  return true;
}

function instanceWithMethod(g: Generator): { victim: Variable; model: ClassModel; method: Method } | undefined {
  const victim = g.variable(kind => kind.is === "instance" && methodsOf(kind.of).length > 0);
  if (!victim || victim.kind.is !== "instance") return undefined;
  return { victim, model: victim.kind.of, method: g.random.pick(methodsOf(victim.kind.of)) };
}

/** A function expression that can stand for the method. */
function replacement(g: Generator, model: ClassModel, method: Method, arrow: boolean): string {
  const parameters = method.parameters.map((kind, i) => ({ name: `q${i}`, kind, mutable: false }));
  const list = parameters.map(parameter => parameter.name + g.annotation(parameter.kind));
  const self = arrow ? [] : fieldsOf({ is: "instance", of: model }).map(field => ({ name: `this.${field.name}`, kind: field.kind, mutable: false }));
  const body = g.withoutCalls(() => g.scoped([...parameters, ...self], () => g.expression(method.result, 1)));
  if (arrow) return `(${list.join(", ")})${g.annotation(method.result)} => ${body}`;
  if (g.typed) list.unshift(`this: ${model.type}`);
  return `function (${list.join(", ")})${g.annotation(method.result)} { return ${body}; }`;
}

function replaceMethodOnPrototype(g: Generator): boolean {
  const found = instanceWithMethod(g);
  if (!found) return false;
  const { victim, model, method } = found;
  let owner = model;
  while (!owner.methods.includes(method) && owner.parent) owner = owner.parent;
  const holder = g.random.chance(0.6) ? g.prototypeOf(owner) : `Object.getPrototypeOf(${victim.name})`;
  const body = replacement(g, owner, method, false);
  strike(
    g,
    victim,
    g.random.weighted<Code[]>([
      [4, [`${member(g, holder, method.name)} = ${body};`]],
      [1, [`Object.defineProperty(${holder}, ${g.computedKey(method.name)}, { value: ${body}, writable: true, configurable: true });`]],
      [1, [`Object.assign(${holder}, { ${method.name}: ${body} });`]],
      [1, [`Reflect.set(${holder}, ${g.computedKey(method.name)}, ${body});`]],
    ]),
  );
  return true;
}

function shadowMethodOnInstance(g: Generator): boolean {
  const found = instanceWithMethod(g);
  if (!found) return false;
  const { victim, model, method } = found;
  strike(g, victim, [`${member(g, victim.name, method.name)} = ${replacement(g, model, method, g.random.chance(0.5))};`]);
  return true;
}

function changePrototype(g: Generator): boolean {
  const found = instanceWithMethod(g);
  if (!found) return false;
  const { victim, model, method } = found;
  const between = g.fresh("between");
  strike(g, victim, [
    `const ${between} = Object.create(${g.prototypeOf(model)});`,
    `${between}.${method.name} = ${replacement(g, model, method, false)};`,
    g.random.weighted<string>([
      [3, `Object.setPrototypeOf(${victim.name}, ${between});`],
      [1, `Reflect.setPrototypeOf(${victim.name}, ${between});`],
      [1, `${g.cast(victim.name)}.__proto__ = ${between};`],
      [1, `${g.cast(victim.name)}[${g.computedKey("__proto__")}] = ${between};`],
    ]),
  ]);
  g.emit(`print("${g.fresh("still")} " + (${victim.name} instanceof ${model.name}) + " " + (Object.getPrototypeOf(${victim.name}) === ${g.prototypeOf(model)}));`);
  return true;
}

function callWithOtherReceiver(g: Generator): boolean {
  const found = instanceWithMethod(g);
  if (!found) return false;
  const { model, method } = found;
  const receiver = g.variable(kind => fieldsOf(kind).length > 0 && !(kind.is === "instance" && kind.of === model));
  const other = receiver ? receiver.name : g.random.pick(["{}", "[1, 2]", "Object.create(null)", "7", '"text"', "undefined"]);
  const list = g.argumentsFor(method.parameters, 1);
  const callee = `${g.prototypeOf(model)}.${method.name}`;
  const call = g.random.weighted<string>([
    [2, `${callee}.call(${[g.cast(other), list].filter(Boolean).join(", ")})`],
    [1, `${callee}.apply(${g.cast(other)}, [${list}])`],
    [1, `Reflect.apply(${callee}, ${other}, [${list}])`],
    [1, `${callee}.bind(${g.cast(other)})(${list})`],
    [1, `${g.cast(`{ borrowed: ${callee}, ${fieldsOf({ is: "instance", of: model }).slice(0, 1).map(field => `${field.name}: ${g.expression(field.kind, 0)}`).join()} }`)}.borrowed(${list})`],
  ]);
  g.emit(...g.attempt([`"${g.fresh("borrowed")} " + String(${call})`]));
  return true;
}

/** Objects get a conversion, a `toJSON`, an iterator or a `then` after code that converts, prints, spreads or awaits them was seen. */
function lateProtocol(g: Generator): boolean {
  const { random } = g;
  const victim = g.variable(kind => fieldsOf(kind).length > 0);
  if (!victim) return false;
  const holder = victim.kind.is === "instance" && random.chance(0.6) ? g.prototypeOf(victim.kind.of) : victim.name;
  const use = g.fresh("use");
  const o = g.cast("o");
  const [key, body, sight] = random.pick<[string, string, string]>([
    [`"valueOf"`, `function () { return ${g.int32(0)}; }`, `(${o} * 2) + " " + (${o} + 1) + " " + (${o} > 1) + " " + (${o} == ${g.int32(0)})`],
    [`"toString"`, `function () { return ${g.string(0)}; }`, `String(o) + " " + \`\${o}\` + " " + (${o} + "!") + " " + [o, o].join("+") + " " + (${g.cast(`{ [${o}]: 1 }`)}[${g.string(0)}] ?? "no")`],
    [`Symbol.toPrimitive`, `function (hint${g.annotation("string")}) { return hint === "number" ? ${g.int32(0)} : hint; }`, `+${o} + " " + \`\${o}\` + " " + (${o} + "")`],
    [`"toJSON"`, `function () { return ${random.pick([g.int32(0), `{ replaced: true }`, `undefined`, `[1]`])}; }`, `JSON.stringify(o, (key, value) => (typeof value === "bigint" ? "big" : value)) + " " + JSON.stringify([o], (key, value) => (typeof value === "bigint" ? "big" : value))`],
    [`Symbol.iterator`, `function* () { yield ${g.int32(0)}; yield ${g.int32(0)}; }`, `(Symbol.iterator in o ? [...${o}].join() + Array.from(${o}).length + Math.max(...${o}) : "not iterable")`],
    [`Symbol.toStringTag`, g.string(0), `Object.prototype.toString.call(o)`],
    [`"then"`, `function (resolve${g.annotation("(value: number) => void")}) { resolve(${g.int32(0)}); }`, `typeof ${o}.then`],
    [`"constructor"`, `Array`, `o.constructor.name + " " + (o.constructor === Object)`],
  ]);
  g.emit(`function ${use}(o${g.annotation("object")})${g.annotation("string")} {`, [`return ${sight};`], `}`);
  g.emit(...g.attempt([`"${use} " + ${use}(${victim.name})`]));
  g.emit(...g.indirectly([random.chance(0.6) ? `${g.cast(holder)}[${key.startsWith('"') ? g.computedKey(key.slice(1, -1)) : key}] = ${body};` : `Object.defineProperty(${holder}, ${key}, { value: ${body}, configurable: true, writable: true });`]));
  g.emit(...g.attempt([`"${use} " + ${use}(${victim.name})`]));
  if (key === `"then"`) g.emit(`print("${use} awaited " + String(await ${victim.name}) + " " + String(await Promise.resolve(${victim.name})) + " " + String(await (async () => ${victim.name})()));`);
  g.emit(`delete ${g.cast(holder)}[${key}];`);
  return true;
}

function disturbArray(g: Generator): boolean {
  const { random } = g;
  const victim = g.variable(kind => kind.is === "array" && kind.element.is !== "function");
  if (!victim || victim.kind.is !== "array") return false;
  const { name } = victim;
  const { element } = victim.kind;
  const alias = g.fresh("alias");
  const value = () => g.expression(element, 1);
  const statements = random.weighted<Code[]>([
    [element.is === "mixed" ? 4 : 0, [`const ${alias} = ${name};`, `${alias}.push(${random.pick(otherValues)});`]],
    [element.is === "mixed" ? 2 : 0, [`${name}[${random.below(3)}] = ${random.pick(otherValues)};`]],
    [element.is === "int32" ? 4 : 0, [`const ${alias} = ${name};`, `${alias}[${random.below(3)}] = ${random.pick(outOfRange)};`]],
    [element.is === "int32" ? 2 : 0, [`${name}.${random.pick(["push", "unshift"])}(${random.pick(outOfRange)});`]],
    [2, [`${name}.length = ${random.pick(["0", "1", `${name}.length + 2`, "7"])};`]],
    [2, [`delete ${name}[${random.below(3)}];`]],
    [2, [`${name}[${name}.length + ${random.between(1, 3)}] = ${value()};`]],
    [1, [`${g.cast(name)}.extra = ${g.int32(0)};`]],
    [1, [`${g.cast(name)}[${g.computedKey("1")}] = ${value()};`]],
    [1, [`Object.defineProperty(${name}, ${random.pick(['"0"', "1"])}, { value: ${value()}, writable: true, enumerable: ${random.chance(0.7)}, configurable: true });`]],
    [1, [`Object.defineProperty(${name}, "length", { value: ${random.below(3)} });`]],
    [1, [`${name}.splice(0, ${name}.length, ${value()}, ${value()});`]],
    [1, [`Reflect.set(${name}, "length", ${random.below(3)});`]],
    [1, [`Array.prototype.push.call(${name}, ${value()});`]],
    [1, [`Object.assign(${name}, { 2: ${value()}, 5: ${value()} });`]],
    [1, [`[${name}[0], ${name}[4]] = [${value()}, ${value()}];`]],
  ]);
  strike(g, victim, statements);
  g.emit(...g.attempt([`"${g.fresh("walk")} " + ${g.listing(name, "item", "typeof item")} + " " + ${g.keysOf(name)} + " " + (1 in ${name}) + " " + ${name}.indexOf(${g.cast("undefined")}) + " " + ${name}.includes(${g.cast("undefined")}) + " " + ${name}.findIndex(item => item === undefined)`]));
  return true;
}

/** An array, a map, a set or a promise stops being like every other one: own members, another prototype, another constructor. */
function spoilInstance(g: Generator): boolean {
  const { random } = g;
  const victim = g.variable(kind => (kind.is === "array" && ["int32", "number", "mixed"].includes(kind.element.is)) || kind.is === "map" || kind.is === "set");
  if (!victim) return false;
  const { name, kind } = victim;
  const loose = g.cast(name);
  const label = g.fresh("spoiled");
  let statements: Code[];
  let sights: string[];
  if (kind.is === "array") {
    const value = g.expression(kind.element, 0);
    sights = [
      `"${label} " + [...${name}].join() + " " + ${name}.map(item => item).length + " " + (${name}.slice() instanceof Array) + " " + ${name}.concat([${value}]).length + " " + Array.from(${name}).join() + " " + Array.isArray(${name})`,
      `"${label} loop " + (() => { let text = ""; for (const item of ${name}) text += String(item) + ";"; for (const key in ${name}) text += key + ","; const [first] = ${name}; return text + String(first); })()`,
      `"${label} holes " + String(${name}[${name}.length]) + " " + String(${name}[1]) + " " + ${name}.join("-") + " " + ${name}.length`,
    ];
    statements = random.pick<Code[]>([
      [`${loose}[Symbol.iterator] = function* () { yield ${value}; };`],
      [`${loose}.constructor = { [Symbol.species]: function (length${g.annotation("number")}) { return { length, made: "species" }; } };`],
      [`${loose}.constructor = undefined;`],
      [`${loose}.map = () => [${value}];`, `${loose}.join = () => "own join";`],
      [`Object.setPrototypeOf(${name}, Object.create(Array.prototype, { 1: { value: ${value}, configurable: true }, 9: { value: ${value} } }));`, `delete ${name}[1];`],
      [`Object.setPrototypeOf(${name}, class extends Array {}.prototype);`],
      [`Object.setPrototypeOf(${name}, { __proto__: Array.prototype, *[Symbol.iterator]() { yield ${value}; } });`],
      [`${loose}[Symbol.isConcatSpreadable] = false;`],
      [`Object.defineProperty(${name}, 0, { get: () => ${value}, configurable: true, enumerable: true });`],
      [`${loose}[-1] = ${value};`, `${loose}["01"] = ${value};`, `${loose}[4294967295] = ${value};`],
    ]);
    g.retire(victim);
  } else {
    const key = kind.is === "map" ? g.expression(kind.key, 0) : kind.is === "set" ? g.expression(kind.element, 0) : "0";
    sights = [
      `"${label} " + ${name}.size + " " + ${name}.has(${key}) + " " + [...${name}].length + " " + [...${name}.keys()].length + " " + new ${kind.is === "map" ? "Map" : "Set"}(${name}).size`,
      `"${label} each " + (() => { let count = 0; ${name}.forEach(() => count++); for (const item of ${name}) count += 10; return count; })()`,
    ];
    statements = random.pick<Code[]>([
      [`${loose}.has = () => "own has";`],
      [`${loose}[Symbol.iterator] = function* () { yield [${key}, ${key}]; };`],
      [`${loose}.forEach = () => undefined;`, `${loose}.keys = () => [1, 2, 3];`],
      [`Object.setPrototypeOf(${name}, class extends ${kind.is === "map" ? "Map" : "Set"} { has() { return false; } }.prototype);`],
      [`Object.defineProperty(${name}, "size", { value: -1, configurable: true });`],
      [`${loose}.extra = 1;`, `Object.freeze(${name});`, kind.is === "map" ? `${loose}.set(${key}, ${key});` : `${loose}.add(${key});`],
    ]);
    g.retire(victim);
  }
  g.emit(...g.attempt(sights), ...g.indirectly(statements), ...g.attempt(sights));
  return true;
}

function mutateWhileIterating(g: Generator): boolean {
  const { random } = g;
  const victim = g.variable(kind => kind.is === "array" && ["int32", "number", "string", "mixed"].includes(kind.element.is));
  if (!victim || victim.kind.is !== "array") return false;
  const { name } = victim;
  const value = g.expression(victim.kind.element, 0);
  const change = random.pick([`${name}.pop();`, `${name}.length = 0;`, `${name}.shift();`, `if (${name}.length < 9) ${name}.push(${value});`, `${name}.splice(0, 1);`, `delete ${name}[${name}.length - 1];`, `if (${name}.length < 9) ${name}.unshift(${value});`, `${name}.reverse();`]);
  const seen = g.fresh("seen");
  g.emit(`const ${seen}${g.annotation("string[]")} = [];`);
  g.emit(
    ...random.weighted<Code[]>([
      [2, [`for (const item of ${name}) {`, [`${seen}.push(String(item));`, change], `}`]],
      [2, [`${name}.forEach((item, index) => {`, [`${seen}.push(index + ":" + String(item));`, change], `});`]],
      [1, [`${seen}.push(String(${name}.map(item => {`, [change, `return String(item);`], `})));`]],
      [1, [`${seen}.push(String(${name}.findLast(item => {`, [change, `return false;`], `})));`]],
      [1, [`for (const [index, item] of ${name}.entries()) {`, [`${seen}.push(index + ":" + String(item));`, change], `}`]],
      [1, [`${seen}.push(String(${name}.filter(item => {`, [change, `return true;`], `})));`]],
      [1, [`${seen}.push(String(${name}.reduce((text, item) => {`, [change, `return text + "|" + String(item);`], `}, "")));`]],
      [1, [`${seen}.push(String(${name}.some(item => {`, [change, `return false;`], `})));`]],
      [1, [`${seen}.push(String([...${name}].sort(() => {`, [change, `return 0;`], `})));`]],
      [1, [`for (let i = 0; i < ${name}.length && i < 12; i++) {`, [`${seen}.push(String(${name}[i]));`, change], `}`]],
      [1, [`for (const key in ${name}) {`, [`${seen}.push(key);`, change], `}`]],
    ]),
  );
  g.emit(`print("${seen} " + ${seen}.join("|") + " " + ${name}.length);`);
  return true;
}

// Built-ins that a program may replace: each is constant only as long as nobody writes it.
const patchable: { holder: string; name: string; use: string }[] = [
  { holder: "Math", name: "max", use: "Math.max(1, 2)" },
  { holder: "Math", name: "min", use: "Math.min(1, 2)" },
  { holder: "Math", name: "floor", use: "Math.floor(2.5)" },
  { holder: "Math", name: "imul", use: "Math.imul(3, 5)" },
  { holder: "Math", name: "abs", use: "Math.abs(-3)" },
  { holder: "Math", name: "sqrt", use: "Math.sqrt(16)" },
  { holder: "JSON", name: "stringify", use: "JSON.stringify([1])" },
  { holder: "JSON", name: "parse", use: 'JSON.parse("[2]")' },
  { holder: "Object", name: "keys", use: "Object.keys({ a: 1 })" },
  { holder: "Object", name: "is", use: "Object.is(0, -0)" },
  { holder: "Object", name: "assign", use: "Object.assign({}, { b: 2 })" },
  { holder: "Object", name: "freeze", use: "Object.isFrozen(Object.freeze({ a: 1 }))" },
  { holder: "Object", name: "create", use: "Object.getPrototypeOf(Object.create(null))" },
  { holder: "Object", name: "entries", use: "Object.entries({ a: 1 })" },
  { holder: "Array", name: "isArray", use: "Array.isArray([])" },
  { holder: "Array", name: "from", use: 'Array.from("ab")' },
  { holder: "Array", name: "of", use: "Array.of(7)" },
  { holder: "Number", name: "isInteger", use: "Number.isInteger(1.5)" },
  { holder: "Number", name: "parseFloat", use: 'Number.parseFloat("1.5x")' },
  { holder: "String", name: "fromCharCode", use: "String.fromCharCode(66)" },
  { holder: "Reflect", name: "ownKeys", use: "Reflect.ownKeys({ c: 3 })" },
  { holder: "Reflect", name: "get", use: 'Reflect.get({ d: 4 }, "d")' },
  { holder: "globalThis", name: "parseInt", use: 'parseInt("12px", 10)' },
  { holder: "globalThis", name: "isNaN", use: "isNaN(0 / 0)" },
  { holder: "globalThis", name: "Number", use: 'Number("5")' },
  { holder: "globalThis", name: "String", use: "String(5)" },
  { holder: "globalThis", name: "Boolean", use: "Boolean(0)" },
  { holder: "Date.prototype", name: "toJSON", use: "JSON.stringify(new Date(0))" },
  { holder: "Date.prototype", name: "getTime", use: "new Date(5).getTime()" },
  { holder: "Error.prototype", name: "toString", use: 'String(new Error("own e"))' },
];

function patchBuiltin(g: Generator): void {
  const { random } = g;
  const { holder, name, use } = random.pick(patchable);
  const [original, calls, probe, key] = [g.fresh("original"), g.fresh("calls"), g.fresh("probe"), g.fresh("key")];
  const text = (value: string) => `JSON.stringify(${value}) + typeof ${value}`;
  g.need("errorName");
  g.emit(
    `function ${probe}()${g.annotation("unknown")} {`,
    [`return ${use};`],
    `}`,
    `const ${probe}Before = ${probe}();`,
    `const ${original} = ${holder}.${name};`,
    `const ${key} = ${g.computedKey(name)};`,
    `let ${calls} = 0;`,
  );
  const body = random.chance(0.6) ? random.pick([`Reflect.apply(${original}, this, values)`, `${g.cast(original)}.apply(this, values)`]) : random.pick(["7", '"patched"', "undefined"]);
  const patch = `function (${g.typed ? "this: unknown, " : ""}...values${g.annotation("any[]")})${g.annotation("any")} { ${calls}++; return ${body}; }`;
  const store = (value: string) =>
    random.weighted<string>([
      [3, `${g.cast(holder)}.${name} = ${value};`],
      [3, `${g.cast(holder)}[${key}] = ${value};`],
      [1, `Object.defineProperty(${holder}, ${key}, { value: ${value}, writable: true, configurable: true });`],
      // Built-in objects are locked in a compiled program. An assignment to one throws; Reflect.set answers false, and nothing would say why the output differs.
      [1, `if (!Reflect.set(${holder}, ${key}, ${value})) throw new TypeError("Attempted to assign to readonly property.");`],
      [1, `Object.assign(${holder}, { [${key}]: ${value} });`],
    ]);
  g.emit(
    ...g.indirectly([store(patch)], true),
    `let ${probe}Patched${g.annotation("unknown")};`,
    `try {`,
    [`${probe}Patched = ${probe}();`],
    `} catch (error) {`,
    [`${probe}Patched = errorName(error);`],
    `}`,
    `${g.cast(holder)}.${name} = ${original};`,
    `print("${probe} " + ${text(`${probe}Before`)} + " " + ${text(`${probe}Patched`)} + " " + ${calls} + " " + ${text(`${probe}()`)} + " " + (${holder}.${name} === ${original}));`,
  );
}

/** A whole namespace object is replaced on the global object, and put back. */
function replaceNamespace(g: Generator): void {
  const { random } = g;
  const [name, use, fake] = random.pick([
    ["Math", "Math.max(1, 2) + Math.PI", `{ max: () => "fake max", PI: "!" }`],
    ["JSON", "JSON.stringify([1])", `{ stringify: () => "fake stringify" }`],
    ["Reflect", "Reflect.ownKeys({ a: 1 }).length", `{ ownKeys: () => "fake" }`],
    ["Object", "Object.keys({ a: 1 }).length", `{ keys: () => "fake" }`],
    ["Array", "Array.isArray([])", `{ isArray: () => "fake" }`],
    ["parseFloat", 'parseFloat("1.5")', `() => "fake"`],
    ["undefinedName", "typeof undefinedName", `1`],
  ]);
  const [probe, kept, key, global] = [g.fresh("probe"), g.fresh("kept"), g.fresh("key"), g.cast("globalThis")];
  if (name === "undefinedName") {
    g.emitType(`declare let undefinedName: unknown;`);
    g.emit(
      `function ${probe}()${g.annotation("string")} {`,
      [`return typeof undefinedName + (typeof undefinedName === "undefined" ? "" : String(undefinedName));`],
      `}`,
      `print("${probe} " + ${probe}());`,
      ...g.indirectly([`${global}[${g.computedKey(name)}] = ${g.int32(0)};`]),
      `print("${probe} " + ${probe}() + " " + ("undefinedName" in globalThis));`,
      ...g.indirectly([`delete ${global}[${g.computedKey(name)}];`]),
      `print("${probe} " + ${probe}());`,
    );
    return;
  }
  g.emit(
    `function ${probe}()${g.annotation("string")} {`,
    [`return String(${use});`],
    `}`,
    `const ${kept} = ${name};`,
    `const ${key} = ${g.computedKey(name)};`,
    `const ${probe}Results = [${probe}()];`,
    ...g.indirectly([`${global}[${key}] = ${fake};`], true),
    `${probe}Results.push(${probe}());`,
    `${global}.${name} = ${kept};`,
    `${probe}Results.push(${probe}());`,
    `print("${probe} " + ${probe}Results.join(" "));`,
  );
}

/** New names on the prototypes of built-in classes, which stay extensible. */
function extendBuiltinPrototype(g: Generator): void {
  const { random } = g;
  const [holder, receiver] = random.pick([
    ["Array.prototype", "[3, 4]"],
    ["String.prototype", '"text"'],
    ["Number.prototype", "(5)"],
    ["Map.prototype", "new Map([[1, 2]])"],
    ["Set.prototype", "new Set([1])"],
    ["Boolean.prototype", "true"],
    ["BigInt.prototype", "5n"],
    ["Date.prototype", "new Date(0)"],
    ["Error.prototype", 'new Error("own e")'],
    ["Symbol.prototype", 'Symbol("s")'],
  ]);
  const name = random.pick(["addedName", "groupish", "zz"]);
  const label = g.fresh("extended");
  const enumerable = random.chance(0.5);
  const probe = g.fresh("probe");
  g.emit(
    `function ${probe}()${g.annotation("string")} {`,
    [`const keys${g.annotation("string[]")} = [];`, `for (const key in [1]) keys.push(key);`, `return typeof ${g.cast(receiver)}.${name} + " " + keys.join() + " " + ("${name}" in Object(${receiver}));`],
    `}`,
    `print("${label} " + ${probe}());`,
    ...g.indirectly([
      enumerable
        ? `${g.cast(holder)}[${g.computedKey(name)}] = function (${g.typed ? "this: unknown" : ""}) { return typeof this + ":" + String(this); };`
        : `Object.defineProperty(${holder}, ${g.computedKey(name)}, { value(${g.typed ? "this: unknown" : ""}) { return typeof this + ":" + String(this); }, configurable: true, writable: true });`,
    ]),
    ...g.attempt([`"${label} " + ${probe}() + " " + ${g.cast(receiver)}.${name}() + " " + ${g.cast(receiver)}[${g.computedKey(name)}].call(1)`]),
    ...g.indirectly([`delete ${g.cast(holder)}.${name};`]),
    `print("${label} " + ${probe}());`,
  );
}

/** A function that saw one shape many times gets another shape, an heir, a proxy or an object with accessors. */
function lateShape(g: Generator): boolean {
  const { random } = g;
  if (g.readers.length === 0) return false;
  const reader = random.pick(g.readers);
  const values = () => reader.fields.map(field => `${field.name}: ${g.expression(field.kind, 1)}`);
  const name = g.fresh("late");
  const type = g.annotation(`{ ${reader.fields.map(field => `${field.name}: ${g.typeText(field.kind)}`).join("; ")} }`);
  const first = reader.fields[0];
  const named = reader.fields.some(field => field.name === "name");
  const plain = reader.fields.every(field => ["int32", "string", "boolean"].includes(field.kind.is));
  g.emit(
    ...random.weighted<Code[]>([
      [2, [`const ${name} = { before: 1, ${values().join(", ")}, after: "z" };`]],
      [2, [`const ${name} = { ${values().reverse().join(", ")} };`]],
      [2, [`const ${name}${type} = new Proxy({ ${values().join(", ")} }, {});`]],
      [2, [`const ${name}${type} = new Proxy({ ${values().join(", ")} }, { get(target, key, receiver) {`, [`mix(String(key).length);`, `return ${random.pick([`Reflect.get(target, key, receiver)`, `${g.cast("target")}[key]`])};`], `} });`]],
      [2, [`const ${name}${type} = { ${[...values().slice(1), `get ${first.name}() { return ${g.expression(first.kind, 1)}; }`].join(", ")} };`]],
      [2, [`const ${name}${type} = Object.create({ ${values().join(", ")} });`]],
      [named ? 0 : 1, [`const ${name}${type} = Object.assign(() => 1, { ${values().join(", ")} });`]],
      [1, [`const ${name}${type} = Object.assign([1, 2], { ${values().join(", ")} });`]],
      [1, [`const ${name}${type} = Object.freeze({ ${values().join(", ")} });`]],
      [1, [`const ${name}${type} = Object.assign(Object.create(null), { ${values().join(", ")} });`]],
      [1, [`const ${name}${type} = new (class { ${values().map(value => value.replace(": ", " = ")).join("; ")}; })();`]],
      [plain ? 1 : 0, [`const ${name}${type} = JSON.parse(JSON.stringify({ ${values().join(", ")} }));`]],
    ]),
  );
  g.need("mix");
  g.emit(...g.attempt([`"${reader.name} late " + ${reader.name}(${name})`]));
  return true;
}

// Operations that convert an operand, which runs the program's code in the middle of the operation. `k` is the operand; `list`,
// `text`, `o` and `bytes` are an array of numbers, a string, an object and a typed array that the code may change.
const conversions = [
  "k * 2", "k + 1", "k - 1", "-k", "+k", "~k", "k | 0", "k >>> 0", "k ** 2", "k % 2", "k < 2", "k >= 2", "k == 1", "k != 1", "`${k}`", '"" + k', "o[k]", "k in o", "delete o[k]", "[5, 6, 7][k]",
  "Number(k)", "String(k)", "parseInt(k)", "parseFloat(k)", "isNaN(k)", "isFinite(k)", "(1.5).toFixed(k)", "(255).toString(k * 2)", "Array.from({ length: k }).length", "new Date(k).getTime()",
  "Symbol(k).description", "new Error(k).message", "JSON.stringify({ a: 1 }, null, k)", "JSON.parse(k)", "Reflect.get(o, k)", "Reflect.has(o, k)", "Object.hasOwn(o, k)", "Object.getOwnPropertyDescriptor(o, k)",
  "o.hasOwnProperty(k)", "o.propertyIsEnumerable(k)", "String.fromCharCode(k)", "String.fromCodePoint(k)", "encodeURIComponent(k)", "RegExp(k).source", "/1/.test(k)", "/1/.exec(k)", "new Int8Array(k).length",
  "new ArrayBuffer(k).byteLength", "Math.max(0, k)", "Math.min(k, 2)", "Math.floor(k)", "Math.pow(k, 2)", "Math.imul(k, 3)", "Math.hypot(k)", "Math.abs(k)", "Math.sign(k)", "Math.clz32(k)", "Math.fround(k)",
  "Math.trunc(k)", "Math.round(k)", "list.fill(0, k)", "list.slice(k)", "list.indexOf(2, k)", "list.includes(2, k)", "list.lastIndexOf(2, k)", "list.splice(k, 1)", "list.copyWithin(0, k)", "list.at(k)",
  "list.with(k, 9)", "list.join(k)", "list.flat(k)", "list.toSpliced(k, 1)", "list[k]", "list[k] = 5", "list.length = k", "list.push(k * 1)", "list.concat(k).length", "list.fill(k * 1)", "list.slice(0, k)",
  "text.slice(k)", "text.charAt(k)", "text.charCodeAt(k)", "text.codePointAt(k)", "text.padStart(k)", "text.repeat(k)", 'text.indexOf("b", k)', "text.substring(k)", "text.at(k)", 'text.startsWith("b", k)',
  'text.split("", k)', 'text.replace("b", k)', "text.concat(k)", "text + k", "text.includes(k)", "text[k]", "text.padEnd(5, k)", "text.lastIndexOf(k)", "text.endsWith(k)", "text.split(k)", "text.replaceAll(k, k)",
  "bytes.fill(k)", "bytes.set([k])", "bytes[0] = k", "bytes[k]", "bytes.subarray(k).length", "bytes.slice(k).length", "bytes.at(k)", "bytes.indexOf(k * 1, k)", "bytes.includes(0, k)", "bytes.copyWithin(0, k)",
  "bytes.with(k, 1)", "bytes.join(k)", "new DataView(bytes.buffer).getInt8(k)", "new DataView(bytes.buffer).setInt8(0, k)", "new Uint8Array(bytes.buffer, k).length", "bytes.buffer.slice(k).byteLength",
  "Object.defineProperty(o, k, { value: 1, configurable: true })", "o[k] = 3", "({ [k]: 1 })", "Object.fromEntries([[k, 1]])", "new Array(3).fill(0).join(k)", "Array.prototype.slice.call({ length: k, 0: 1 })",
  "Function.prototype.apply.call(Math.max, null, { length: k, 0: 4 })", "BigInt(k)", "BigInt.asIntN(k, 5n)", "Number.prototype.toPrecision.call(1.25, k)", "new Set([1]).has(k * 1)", "Array(k * 1).length",
  "[3, 1, 2].sort((a, b) => (a - b) * k)", "[1, 2].map(item => item * k)", "Number.isInteger(k)", "Object.is(k, 1)", "Array.isArray(k)", "typeof k", "k === 1", "k ?? 2", "k || 2", "!k", "[k].includes(1)",
];

function hiddenEffects(g: Generator): void {
  const { random } = g;
  const a = (type: string) => g.annotation(type);
  const [probe, shared, trigger] = [g.fresh("probe"), g.fresh("shared"), g.fresh("trigger")];
  const operation = random.pick(conversions);
  const effect = random.sample(
    [`o.x = ${random.pick(["99", "0.5", '"changed"', "undefined"])};`, `o.x++;`, `delete o.x;`, `o[1] = "one";`, `list.length = 0;`, `list.push(9, 9, 9, 9, 9, 9, 9, 9);`, `list[0] = ${random.pick(["0.5", '"s"', "undefined", "{}"])};`, `list.shift();`, `delete list[1];`, `${shared}++;`, `bytes[0] = 77;`, `bytes.fill(3);`, `list.reverse();`, `Object.freeze(o);`],
    random.between(1, 2),
  );
  const hook = random.pick<Code[]>([
    [`valueOf() {`, [`fire();`, `return 1;`], `},`, `toString() {`, [`fire();`, `return "1";`], `},`],
    [`[Symbol.toPrimitive]() {`, [`fire();`, `return 1;`], `},`],
    [`toString() {`, [`fire();`, `return "1";`], `},`],
    [`valueOf() {`, [`fire();`, `return 1;`], `},`],
  ]);
  g.emit(
    `let ${shared} = 0;`,
    `function ${probe}(k${a("any")}, o${a("any")}, list${a("any[]")}, text${a("string")}, bytes${a("Uint8Array")})${a("string")} {`,
    [
      `const before = [o.x, list.length, list[0], list[1], ${shared}, bytes[0]];`,
      `const result = ${operation};`,
      `return before.join() + " > " + [o.x, list.length, list[0], list[1], ${shared}, bytes[0]].join() + " = " + (typeof result === "object" ? JSON.stringify(result) : String(result));`,
    ],
    `}`,
    `function ${trigger}(o${a("any")}, list${a("any[]")}, bytes${a("Uint8Array")})${a("object")} {`,
    [`let fired = false;`, `const fire = () => {`, [`if (fired) return;`, `fired = true;`, ...effect], `};`, `return {`, hook, `};`],
    `}`,
    `for (const k of [1, 0, 2]) {`,
    g.attempt([`"${probe} " + ${probe}(k, { x: 1, y: 2 }, [1, 2, 3], "abc", new Uint8Array(4))`]),
    `}`,
    `{`,
    [`const o = { x: 1, y: 2 };`, `const list = [1, 2, 3];`, `const bytes = new Uint8Array(4);`, ...g.attempt([`"${probe} late " + ${probe}(${trigger}(o, list, bytes), o, list, "abc", bytes)`, `"${probe} after " + JSON.stringify(o) + JSON.stringify(list) + bytes.join()`])],
    `}`,
  );
}

/** Something a callback does between two reads of the same place in one function. */
function changeBetweenReads(g: Generator): boolean {
  const { random } = g;
  const found = holderWith(g, kind => ["int32", "number", "mixed"].includes(kind.is));
  if (!found) return false;
  const { victim, field } = found;
  const [twice, act] = [g.fresh("twice"), g.fresh("act")];
  const place = `o.${field.name}`;
  const call = random.pick([`act();`, `[0].forEach(act);`, `act.call(undefined);`, `void \`\${{ toString: act }}\`;`, `new Set([1]).forEach(act);`, `[2, 1].sort(act);`, `"a".replace("a", act);`, `Reflect.apply(act, undefined, []);`, `void { get now() { return act(); } }.now;`]);
  g.emit(
    `function ${twice}(o${g.annotation(victim.kind)}, act${g.annotation("() => any")})${g.annotation("string")} {`,
    [`const first = ${place};`, call, `const second = ${place};`, `return String(first) + "," + String(second) + "," + String(${place});`],
    `}`,
    `print("${twice} " + ${twice}(${victim.name}, () => ""));`,
    `const ${act} = () => {`,
    [...storeThrough(g, victim.name, field.name, field.kind.is === "mixed" ? random.pick(otherValues) : random.pick(outOfRange)), `return "";`],
    `};`,
    `print("${twice} " + ${twice}(${victim.name}, ${act}));`,
  );
  return true;
}

const attacks: Step[] = [
  { name: "store-other-kind", weight: 5, run: storeOtherKind },
  { name: "store-other-kind-in-variable", weight: 2, run: storeOtherKindInVariable },
  { name: "store-other-kind-in-static", weight: 2, run: storeOtherKindInStatic, alone: true },
  { name: "leave-int32-range", weight: 4, run: leaveInt32Range },
  { name: "add-property", weight: 3, run: addProperty },
  { name: "delete-property", weight: 3, run: deleteProperty },
  { name: "redefine-as-accessor", weight: 3, run: redefineAsAccessor },
  { name: "accessor-on-prototype", weight: 3, run: accessorOnPrototype },
  { name: "replace-method-on-prototype", weight: 4, run: replaceMethodOnPrototype },
  { name: "shadow-method-on-instance", weight: 3, run: shadowMethodOnInstance },
  { name: "change-prototype", weight: 3, run: changePrototype },
  { name: "call-with-other-receiver", weight: 2, run: callWithOtherReceiver },
  { name: "late-protocol", weight: 4, run: lateProtocol },
  { name: "disturb-array", weight: 5, run: disturbArray },
  { name: "mutate-while-iterating", weight: 3, run: mutateWhileIterating },
  { name: "patch-builtin", weight: 2, run: patchBuiltin, alone: true },
  { name: "replace-namespace", weight: 1, run: replaceNamespace, alone: true },
  { name: "extend-builtin-prototype", weight: 1, run: extendBuiltinPrototype, alone: true },
  { name: "late-shape", weight: 5, run: lateShape },
  { name: "hidden-effects", weight: 3, run: hiddenEffects, alone: true },
  { name: "change-between-reads", weight: 4, run: changeBetweenReads },
];

/** Attacks after which ordinary code would throw: nothing but careful looks follows them. */
const lastAttacks: Step[] = [
  { name: "make-read-only", weight: 2, run: makeReadOnly },
  { name: "spoil-instance", weight: 3, run: spoilInstance },
];

/** The steps that make a program by themselves. */
const scenes: Step[] = [...features, ...attacks].filter(step => step.alone);
