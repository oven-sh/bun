// `function Top() {}` is never constructed; classes stand below it. The program changes something about Top (links its prototype
// object below another, adds, replaces or deletes a member there, does the same on the static side) BEFORE anything has asked about
// Top, and only then asks through an instance, or the constructor, of a class below. A run time that watches such things only from the
// first look on must not take the state behind the change for the state that was never changed. Each scene varies what stands on top
// and between, what is there at first, the change, how it is made (in place, in a callback of another function, through a value nobody
// follows), whether the instance was made before or behind it, whether it reaches unknown code, and what is asked. A second change
// follows the first answers, and everything is asked again.
import type { Random } from "./random";

/** `@` is the number of the scene. */
const tops = [
  "function Top@() {}",
  "function Top@() {}",
  "const Top@ = function () {};",
  "class Top@ {}",
  "function Top@() {}\nfunction Over@() {}\nObject.setPrototypeOf(Top@.prototype, Over@.prototype);",
];
const middles = [
  "function Middle@() {}\nObject.setPrototypeOf(Middle@.prototype, Top@.prototype);",
  "function Middle@() {}\nObject.setPrototypeOf(Middle@.prototype, Top@.prototype);\nObject.setPrototypeOf(Middle@, Top@);",
  "function Middle@() {}\nMiddle@.prototype = Object.create(Top@.prototype, { constructor: { value: Middle@, writable: true, configurable: true } });",
  "class Middle@ extends Top@ {}",
  "const Middle@ = Top@;",
];
const atFirst = [
  'Top@.prototype.greet = function () {\n  return "top";\n};',
  'Top@.prototype.greet = function () {\n  return "top";\n};',
  'Object.defineProperty(Top@.prototype, "greet", { get() { return () => "top by a getter"; }, configurable: true });',
  "Top@.prototype.size = 1;",
  "Top@.fixed = 1;",
  'Top@.make = function () {\n  return "made by top";\n};',
  'Middle@.prototype.greet = function () {\n  return "middle";\n};',
];

/** `P` is the prototype object of Top, `S` Top itself, each as the way of the scene reaches it. */
const changes = [
  "Object.setPrototypeOf(P, Object.create(Base@.prototype));",
  "Object.setPrototypeOf(P, Object.create(Base@.prototype));",
  "Object.setPrototypeOf(P, Base@.prototype);",
  "Reflect.setPrototypeOf(P, Base@.prototype);",
  "P.__proto__ = Base@.prototype;",
  "Object.setPrototypeOf(P, null);",
  'P.added = function () {\n    return "added";\n  };',
  'P.greet = function () {\n    return "replaced";\n  };',
  'P.greet = function () {\n    return "replaced";\n  };',
  "delete P.greet;",
  "delete P.size;",
  "P.size = 2;",
  'Object.defineProperty(P, "greet", { get() { return () => "by a getter"; }, configurable: true });',
  'Object.defineProperty(P, "size", { get() { return "by a getter"; }, configurable: true });',
  'Object.defineProperty(P, "greet", { value: () => "defined", writable: false, configurable: true });',
  'Object.assign(P, { greet() { return "assigned"; }, added() { return "assigned too"; } });',
  "P.constructor = Base@;",
  "delete P.constructor;",
  'P[Symbol.toStringTag] = "Tagged";',
  'P.toString = function () {\n    return "text of its own";\n  };',
  "P.valueOf = function () {\n    return 42;\n  };",
  'P[Symbol.toPrimitive] = function () {\n    return "primitive";\n  };',
  "P[Symbol.iterator] = function* () {\n    yield 1;\n    yield 2;\n  };",
  "Object.freeze(P);",
  "Object.preventExtensions(P);",
  "Object.setPrototypeOf(S, Base@);",
  "Object.setPrototypeOf(S, Base@);",
  "Object.setPrototypeOf(S, null);",
  "S.fixed = 2;",
  "delete S.fixed;",
  'S.make = function () {\n    return "made anew";\n  };',
  "delete S.make;",
  'Object.defineProperty(S, "fixed", { get() { return "by a getter"; }, configurable: true });',
  "Object.defineProperty(S, Symbol.hasInstance, { value: () => true, configurable: true });",
  "Object.defineProperty(S, Symbol.hasInstance, { value: () => false, configurable: true });",
  "Object.defineProperty(Base@, Symbol.hasInstance, { value: () => true, configurable: true });",
  'Object.defineProperty(S, "name", { value: "Renamed" });',
];

const questions = [
  "first@ instanceof Base@",
  "first@ instanceof Base@",
  "first@ instanceof Top@",
  "first@ instanceof Middle@",
  "new Lowest@() instanceof Base@",
  "new Lowest@() instanceof Top@",
  "Base@.prototype.isPrototypeOf(first@)",
  "Top@.prototype.isPrototypeOf(first@)",
  "first@.greet?.()",
  "first@.greet?.()",
  "new Lowest@().greet?.()",
  "first@.added?.()",
  "first@.base?.()",
  "first@.size",
  '"added" in first@',
  '"greet" in first@',
  '"base" in first@',
  "first@.constructor?.name",
  "Lowest@.fixed",
  "Lowest@.make?.()",
  "Lowest@.still?.()",
  '"fixed" in Lowest@',
  "Object.getPrototypeOf(Lowest@) === Middle@",
  "Base@.isPrototypeOf(Lowest@)",
  "String(first@)",
  "`${first@}`",
  'first@ + ""',
  "Object.prototype.toString.call(first@)",
  'typeof first@[Symbol.iterator] === "function" ? [...first@].join() : "no iterator"',
  "chain(first@)",
  "chain(Lowest@)",
  "(() => { let hits = 0; for (let turn = 0; turn < 40; turn++) if (first@ instanceof Base@) hits++; return hits; })()",
  '(() => { let text = ""; for (let turn = 0; turn < 3; turn++) text += first@.greet?.(); return text; })()',
  "(() => { const names = []; for (const name in first@) names.push(name); return names.join(); })()",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  const count = random.pick([1, 1, 2, 3]);
  for (let scene = 0; scene < count; scene++) {
    const fill = (text: string) => text.replaceAll("@", String(scene));
    const middle = random.pick(middles);
    const reach = random.pick([
      ["Top@.prototype", "Top@"],
      ["Top@.prototype", "Top@"],
      ["hide(Top@.prototype)", "hide(Top@)"],
      // Where the middle is the top itself, what lies above its prototype object is Object.prototype, which an executable locks.
      [middle.startsWith("const ") ? "Top@.prototype" : "Object.getPrototypeOf(Middle@.prototype)", "Top@"],
      ["held@.prototype", "held@"],
    ]);
    const change = () => random.pick(changes).replace(/\bP\b/g, reach[0]).replace(/\bS\b/g, reach[1]);
    const made = (text: string) =>
      random.pick([
        `told(() => {\n  ${text}\n});`,
        `told(() => {\n  ${text}\n});`,
        `try {\n  ${text}\n} catch (error) {\n  console.log("${scene} the change throws", error.constructor.name);\n}`,
        `[0].forEach(() => told(() => {\n  ${text}\n}));`,
      ]);
    const asked = Array.from({ length: random.between(3, 8) }, () => random.pick(questions));
    const ask = (label: string) =>
      `console.log("${scene} ${label}", [${asked.map(question => `told(() => ${question})`).join(", ")}].join(" | "));`;
    const instance = "const first@ = new Lowest@();";
    const isMadeFirst = random.chance(0.7);
    scenes.push(
      fill(
        [
          "{",
          random.pick(tops),
          middle,
          "class Lowest@ extends Middle@ {}",
          'class Base@ {\n  base() {\n    return "base";\n  }\n  static still() {\n    return "still";\n  }\n}',
          "const held@ = [Top@][0];",
          ...atFirst.filter(() => random.chance(0.3)),
          ...(isMadeFirst ? [instance] : []),
          ...(random.chance(0.15) && isMadeFirst ? [ask("asked first")] : []),
          made(change()),
          ...(isMadeFirst ? [] : [instance]),
          ...(random.chance(0.6) ? ["hide(first@);"] : []),
          ask("behind the change"),
          made(change()),
          ask("behind the second"),
          "}",
        ].join("\n"),
      ),
    );
  }
  return `const hide = new Function("value", process.argv[9] ?? "return value");
function told(ask) {
  try {
    return String(ask());
  } catch (error) {
    return "throws " + error.constructor.name;
  }
}
function chain(it) {
  const names = [];
  for (let at = Object.getPrototypeOf(it); at && names.length < 9; at = Object.getPrototypeOf(at))
    names.push(typeof at === "function" ? "function " + at.name : Object.hasOwn(at, "constructor") ? at.constructor?.name : "nameless");
  return names.join("<");
}
${scenes.join("\n")}
`;
}
