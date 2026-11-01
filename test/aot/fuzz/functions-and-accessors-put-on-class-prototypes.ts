// `Point.prototype.norm = function () {..}` and `Object.defineProperty(Point.prototype, "x", { get() {..} })` behind a class
// declaration. A compiler may treat such a function or accessor as a member of the class, as long as the prototype really
// holds it. Each scene has classes of its own at the top of the file, one statement that puts the member there (sometimes
// late, sometimes never), small functions that read it as a value, call it, compare it and store through it for instances
// of the class and of two classes below, and a few steps that make the member something else: another function, a
// constant, an accessor for a function or the other way round, a delete, an own property, a class in between that answers
// first, another prototype. The same questions are asked at first and after every step.
import type { Random } from "./random";

const functions = [
  "function () {\n  return 21;\n}",
  "function () {\n  return 21;\n}",
  "function (THIS) {\n  return this.a;\n}",
  "function (THIS) {\n  return this.a;\n}",
  "() => 22",
  "helper",
  "function named() {\n  return 24;\n}",
];

const accessors = [
  "{ get() {\n  return 31;\n}, configurable: true }",
  "{ get(THIS) {\n  return this.a;\n}, configurable: true }",
  "{ get(THIS) {\n  return this.a;\n}, set(value) {\n  hits++;\n}, configurable: true }",
  "{ get() {\n  return 32;\n}, set(THISvalue) {\n  this.a = value;\n}, configurable: true, enumerable: true }",
  "{ set(value) {\n  hits += 2;\n}, configurable: true }",
  "{ get: helper, configurable: true }",
  "{ get() {\n  return helper;\n}, configurable: true }",
];

/** Statements that put FUNCTION on the prototype of Kind under `member`. */
const storesOfFunctions = [
  "Kind.prototype.member = FUNCTION;",
  "Kind.prototype.member = FUNCTION;",
  "Kind.prototype.member = FUNCTION;",
  'Kind.prototype["member"] = FUNCTION;',
  "Object.assign(Kind.prototype, { member: FUNCTION });",
  "Object.assign(Kind.prototype, {\n  member() {\n    return 25;\n  },\n});",
  'Object.defineProperty(Kind.prototype, "member", { value: FUNCTION, writable: true, configurable: true });',
  "const proto = Kind.prototype;\nproto.member = FUNCTION;",
  'for (const name of ["member", "second"]) {\n  Kind.prototype[name] = function () {\n    return name;\n  };\n}',
  'if (word("yes") === "yes") Kind.prototype.member = FUNCTION;',
  'if (word("yes") === "no") Kind.prototype.member = FUNCTION;',
  "for (const each of [Kind]) each.prototype.member = FUNCTION;",
];

/** Statements that define ACCESSOR there. */
const storesOfAccessors = [
  'Object.defineProperty(Kind.prototype, "member", ACCESSOR);',
  'Object.defineProperty(Kind.prototype, "member", ACCESSOR);',
  'Object.defineProperty(Kind.prototype, "member", ACCESSOR);',
  "Object.defineProperties(Kind.prototype, { member: ACCESSOR });",
  'Reflect.defineProperty(Kind.prototype, "member", ACCESSOR);',
  'for (const name of ["member", "second"]) {\n  Object.defineProperty(Kind.prototype, name, {\n    get() {\n      return name;\n    },\n    configurable: true,\n  });\n}',
  'if (word("yes") === "yes") Object.defineProperty(Kind.prototype, "member", ACCESSOR);',
  'if (word("yes") === "no") Object.defineProperty(Kind.prototype, "member", ACCESSOR);',
  'const proto = Kind.prototype;\nObject.defineProperty(proto, "member", ACCESSOR);',
];

/** Steps after which the member may be something else. */
const steps = [
  "Kind.prototype.member = function () {\n  return 41;\n};",
  "Kind.prototype.member = function () {\n  return 41;\n};",
  "Kind.prototype.member = helper;",
  "Kind.prototype.member = 4;",
  "Kind.prototype.member = undefined;",
  "delete Kind.prototype.member;",
  "delete Kind.prototype.member;",
  'Object.defineProperty(Kind.prototype, "member", { get: () => (hits++, 9), configurable: true });',
  'Object.defineProperty(Kind.prototype, "member", { get: () => () => 42, configurable: true });',
  'Object.defineProperty(Kind.prototype, "member", { value: () => 43, writable: false, configurable: true });',
  'Object.defineProperty(Kind.prototype, "member", { value: 5, writable: true, configurable: true });',
  'Object.defineProperty(Kind.prototype, "member", { enumerable: true });',
  "Object.freeze(Kind.prototype);",
  "one.member = 7;",
  "one.member = () => 44;",
  "delete one.member;",
  'Object.defineProperty(one, "member", { get: () => (hits++, 8), configurable: true });',
  "Below.prototype.member = function () {\n  return 45;\n};",
  "Below.prototype.member = 6;",
  'Object.defineProperty(Below.prototype, "member", { get: () => 46, configurable: true });',
  "delete Below.prototype.member;",
  "Object.setPrototypeOf(one, Other.prototype);",
  "Object.setPrototypeOf(one, null);",
  "Object.setPrototypeOf(one, { __proto__: Kind.prototype, member: () => 47 });",
  "Object.setPrototypeOf(Kind.prototype, { member: () => 48 });",
  "Object.setPrototypeOf(Below.prototype, Other.prototype);",
  'Kind.prototype[word("member")] = () => 49;',
  'Reflect.set(Kind.prototype, "member", () => 50);',
  'Reflect.set(Kind.prototype, "member", 15, one);',
  "Kind.prototype.other = 1;",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = (name: string) => (typed ? `(${name} as any)` : name);
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const isAccessor = random.chance(0.45);
    const member = random
      .pick(isAccessor ? accessors : functions)
      .replaceAll("(THISvalue)", typed ? "(this: any, value: any)" : "(value)")
      .replaceAll("(THIS)", typed ? "(this: any)" : "()")
      .replaceAll("(value)", typed ? "(value: any)" : "(value)");
    const declared = random.pick([
      "",
      "",
      "",
      "",
      typed ? "declare member: any;" : "",
      typed ? "member?: any;" : "member;",
    ]);
    const picked = random.sample(steps, random.between(1, 4));
    const isStoredLate = random.chance(0.35);
    const store = random
      .pick(isAccessor ? storesOfAccessors : storesOfFunctions)
      .replaceAll(isAccessor ? "ACCESSOR" : "FUNCTION", member);
    const loose = (text: string) =>
      typed
        ? text
            .replace(/\b(Kind|Below|Other)\.prototype\b(?=\.|\[)/g, "($1.prototype as any)")
            .replace(/\bone\.member\b/g, "(one as any).member")
            .replace("each.prototype.", "(each.prototype as any).")
            .replace("const proto = Kind.prototype;", "const proto = Kind.prototype as any;")
        : text;
    const text = `class Kind {
  a${as("number")};
  ${declared}
  constructor(a${as("number")}) {
    this.a = a;
  }
  own()${as("unknown")} {
    return ${any("this")}.member;
  }
  calls()${as("unknown")} {
    return ${any("this")}.member();
  }
}
class Below extends Kind {}
class Lowest extends Below {}
class Other {
  get member() {
    return "of the other class";
  }
}
${isStoredLate ? "" : loose(store)}
function read(it${as("Kind")})${as("unknown")} {
  return ${any("it")}.member;
}
function call(it${as("Kind")})${as("unknown")} {
  try {
    return ${any("it")}.member();
  } catch (error) {
    return ${typed ? "(error as Error)" : "error"}.name;
  }
}
function same(it${as("Kind")}, other${as("Kind")})${as("string")} {
  return [${any("it")}.member === ${any("other")}.member, ${any("it")}.member === ${any("Kind.prototype")}.member].join("");
}
function put(it${as("Kind")})${as("string")} {
  try {
    ${any("it")}.member = 60;
  } catch (error) {
    return ${typed ? "(error as Error)" : "error"}.name;
  }
  const answer = shown(${any("it")}.member) + Object.keys(it).join("+") + it.a;
  delete ${any("it")}.member;
  return answer;
}
function total(it${as("Kind")})${as("number")} {
  let sum = 0;
  for (let i = 0; i < ${random.pick([1, 50, 300])}; i++) {
    const found = ${any("it")}.member;
    sum += Number(typeof found === "function" ? ${any("it")}.member() : found) || 0;
  }
  return sum;
}
const one = new Kind(1);
function asked()${as("string")} {
  const answers${as("unknown[]")} = [];
  try {
    const fresh = new Kind(2);
    const lower = new Below(3);
    const lowest = new Lowest(4);
    answers.push(shown(read(one)), shown(read(fresh)), shown(read(lower)), shown(read(lowest)));
    answers.push(shown(call(one)), shown(call(fresh)), shown(call(lower)), shown(call(lowest)));
    answers.push(same(one, fresh), same(fresh, lower), same(lower, lowest), total(one), total(fresh), total(lowest), shown(fresh.own()));
    answers.push(${random.chance(0.5) ? "put(fresh), put(lower)" : '"no store"'}, "member" in one, Object.keys(one).join("+"), Object.hasOwn(Kind.prototype, "member"));
    answers.push(typeof Object.getOwnPropertyDescriptor(Kind.prototype, "member")?.get, shown(lower.calls()));
  } catch (error) {
    answers.push("threw " + ${typed ? "(error as Error)" : "error"}.name);
  }
  return answers.join() + " hits " + hits;
}
console.log("scene ${scene} at first", asked());
${[...(isStoredLate ? [store] : []), ...picked]
  .map(
    (step, at) =>
      `try {\n  ${loose(step).replaceAll("\n", "\n  ")}\n} catch (error) {\n  console.log("scene ${scene} step ${at} threw", ${typed ? "(error as Error)" : "error"}.name);\n}\nconsole.log("scene ${scene} after step ${at}", asked());`,
  )
  .join("\n")}`;
    scenes.push(
      text.replace(/\b(Kind|Below|Lowest|Other|read|call|same|put|total|one|asked|proto)\b(?!:)/g, `$1${scene}`),
    );
  }
  return `let hits = 0;
const word = (text${as("string")})${as("string")} => process.argv[9] ?? text;
function helper() {
  return 23;
}
function shown(value${as("unknown")})${as("string")} {
  return typeof value === "function" ? "function " + value.name + value.length : typeof value + " " + String(value);
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
