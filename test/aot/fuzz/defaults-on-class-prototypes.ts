// `Message.prototype.retries = 3`: a default on the prototype of a class, read through instances that may or may not have a
// field of that name. Where the program stores it once, with a constant, the compiler may read the constant without a lookup,
// as long as the prototype still holds it. Each scene has a class of its own at the top of the file, one store of a default,
// a function that reads it through an instance in a loop, and a few steps that make the constant wrong: a second store, another
// kind of value, an accessor, a delete, an own property, a subclass or an object in between that answers first, another
// prototype for the instance. The same questions are asked at first and after every step.
import type { Random } from "./random";

const defaults = [
  "3",
  "3",
  "0",
  "-1",
  "true",
  "false",
  "null",
  "2147483647",
  "2147483648",
  "0.5",
  '"text"',
  "undefined",
  "-0",
  "[1]",
  "NaN",
];

/** Statements that put DEFAULT on the prototype of Kind under `retries`. */
const stores = [
  "Kind.prototype.retries = DEFAULT;",
  "Kind.prototype.retries = DEFAULT;",
  "Kind.prototype.retries = DEFAULT;",
  'Kind.prototype["retries"] = DEFAULT;',
  'Object.defineProperty(Kind.prototype, "retries", { value: DEFAULT, writable: true, enumerable: true, configurable: true });',
  "Object.assign(Kind.prototype, { retries: DEFAULT });",
  "const proto = Kind.prototype;\nproto.retries = DEFAULT;",
  'if (word("yes") === "yes") Kind.prototype.retries = DEFAULT;',
  "for (const each of [Kind]) each.prototype.retries = DEFAULT;",
  "",
];

/** Steps after which the constant may be wrong. */
const steps = [
  "Kind.prototype.retries = 4;",
  "Kind.prototype.retries = DEFAULT;",
  'Kind.prototype.retries = "another kind";',
  "Kind.prototype.retries = undefined;",
  "delete Kind.prototype.retries;",
  'Object.defineProperty(Kind.prototype, "retries", { get: () => (hits++, 9), configurable: true });',
  'Object.defineProperty(Kind.prototype, "retries", { value: 5, writable: false, configurable: true });',
  'Object.defineProperty(Kind.prototype, "retries", { enumerable: false });',
  "Object.freeze(Kind.prototype);",
  "one.retries = 7;",
  "one.retries = undefined;",
  "delete one.retries;",
  'Object.defineProperty(one, "retries", { get: () => (hits++, 8), configurable: true });',
  "Below.prototype.retries = 6;",
  "Object.setPrototypeOf(one, Other.prototype);",
  "Object.setPrototypeOf(one, null);",
  "Object.setPrototypeOf(one, { __proto__: Kind.prototype, retries: 11 });",
  "Object.setPrototypeOf(Kind.prototype, { retries: 12 });",
  "Object.setPrototypeOf(Below.prototype, Other.prototype);",
  'Kind.prototype[word("retries")] = 13;',
  'Reflect.set(Kind.prototype, "retries", 14);',
  'Reflect.set(Kind.prototype, "retries", 15, one);',
  "one.retries++;",
  "Kind.prototype.retries++;",
  "Kind.prototype.other = 1;",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = (name: string) => (typed ? `(${name} as any)` : name);
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const value = random.pick(defaults);
    const declared = random.pick([
      "",
      "",
      "",
      typed ? "declare retries: any;" : "",
      typed ? "retries?: any;" : "retries;",
      "retries = 1;",
    ]);
    const picked = random.sample(steps, random.between(1, 4)).map(step => step.replaceAll("DEFAULT", value));
    const isStoredLate = random.chance(0.25);
    const store = random.pick(stores).replaceAll("DEFAULT", value);
    const loose = (text: string) => (typed ? text.replace(/\b(Kind|Below|Other)\.prototype\b/g, "($1.prototype as any)").replace(/\bone\.retries\b/g, "(one as any).retries").replace("each.prototype", "(each.prototype as any)").replace("= Kind.prototype;", "= Kind.prototype as any;") : text); // prettier-ignore
    const text = `class Kind {
  a${as("number")};
  ${declared}
  constructor(a${as("number")}) {
    this.a = a;
  }
  own()${as("unknown")} {
    return ${any("this")}.retries;
  }
}
class Below extends Kind {}
class Other {
  get retries() {
    return "of the other class";
  }
}
${isStoredLate ? "" : loose(store)}
function read(it${as("Kind")})${as("unknown")} {
  return ${any("it")}.retries;
}
function total(it${as("Kind")})${as("number")} {
  let sum = 0;
  for (let i = 0; i < ${random.pick([1, 50, 300])}; i++) sum += Number(${any("it")}.retries) || 0;
  return sum;
}
const one = new Kind(1);
function asked()${as("string")} {
  const answers${as("unknown[]")} = [];
  try {
    const fresh = new Kind(2);
    const lower = new Below(3);
    answers.push(shown(read(one)), shown(read(fresh)), shown(read(lower)), total(one), total(fresh), shown(fresh.own()));
    answers.push("retries" in one, Object.keys(one).join("+"), Object.hasOwn(Kind.prototype, "retries"), shown(${any("Kind.prototype")}.retries));
  } catch (error) {
    answers.push("threw " + ${typed ? "(error as Error)" : "error"}.name);
  }
  return answers.join() + " hits " + hits;
}
console.log("scene ${scene} at first", asked());
${[...(isStoredLate ? [store] : []), ...picked].map((step, at) => `try {\n  ${loose(step).replaceAll("\n", "\n  ")}\n} catch (error) {\n  console.log("scene ${scene} step ${at} threw", ${typed ? "(error as Error)" : "error"}.name);\n}\nconsole.log("scene ${scene} after step ${at}", asked());`).join("\n")}`;
    scenes.push(text.replace(/\b(Kind|Below|Other|read|total|one|asked|proto)\b(?!:)/g, `$1${scene}`));
  }
  return `let hits = 0;
const word = (text${as("string")})${as("string")} => process.argv[9] ?? text;
function shown(value${as("unknown")})${as("string")} {
  return Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
