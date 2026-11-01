// `x instanceof Leaf` first asks Leaf for Symbol.hasInstance, which it normally finds on Function.prototype. A program may put
// the constructor function below another function, a class, a proxy, a plain object or nothing, and any of those may answer
// under that symbol. Each scene has three constructor functions of its own, links them in one of several ways, and defines a
// handler somewhere above, or not at all: before the link, after it, after the first questions, under a key or on a function
// that the compiler cannot follow. The same questions are asked before and after each step, some of them in a loop.
import type { Random } from "./random";

/** Expressions for what Leaf is put below. */
const above = [
  "Middle",
  "Middle",
  "Middle",
  "Root",
  'class {\n    static [Symbol.hasInstance]() {\n      log.push("of the class");\n      return true;\n    }\n  }',
  "class {}",
  "new Proxy(Middle, {})",
  'new Proxy(Middle, { get: (target, name, receiver) => (log.push("get " + String(name)), Reflect.get(target, name, receiver)) })',
  "new Proxy(Middle, { get: (target, name) => (name === Symbol.hasInstance ? () => true : target[name]) })",
  "null",
  "{}",
  "{ [Symbol.hasInstance]: () => true }",
  "Middle.bind(null)",
  "Object.create(Function.prototype, { [Symbol.hasInstance]: { value: () => true } })",
  "hide(Middle)",
  "Function.prototype",
];

/** Statements that put Leaf below ABOVE. */
const links = [
  "Object.setPrototypeOf(Leaf, ABOVE);",
  "Object.setPrototypeOf(Leaf, ABOVE);",
  "Reflect.setPrototypeOf(Leaf, ABOVE);",
  "Leaf.__proto__ = ABOVE;",
  "Object.setPrototypeOf(hide(Leaf), ABOVE);",
  "Object.setPrototypeOf(Leaf, Root);\n  Object.setPrototypeOf(Leaf, ABOVE);",
  "Object.setPrototypeOf(Middle, Root);\n  Object.setPrototypeOf(Leaf, ABOVE);",
  "",
];

/** Statements that define a handler. */
const handlers = [
  "",
  "",
  "",
  'Object.defineProperty(Middle, Symbol.hasInstance, { value: () => (log.push("of Middle"), true), configurable: true });',
  'Object.defineProperty(Root, Symbol.hasInstance, { value: () => (log.push("of Root"), true), configurable: true });',
  'Object.defineProperty(Leaf, Symbol.hasInstance, { value: () => (log.push("of Leaf"), false), configurable: true });',
  'Object.defineProperty(Middle, SYMBOLS[word("hasInstance")], { value: () => true, configurable: true });',
  "Object.defineProperty(hide(Middle), Symbol.hasInstance, { value: () => true, configurable: true });",
  'Object.defineProperty(Middle, Symbol.hasInstance, { get: () => (log.push("getter"), undefined), configurable: true });',
  "Object.defineProperty(Middle, Symbol.hasInstance, { value: 5, configurable: true });",
  'Object.defineProperty(Middle, Symbol.hasInstance, { value: () => "", configurable: true });',
  "Object.defineProperty(Middle, Symbol.hasInstance, { value: it => it === marked, configurable: true });",
  "Object.defineProperties(Middle, { [Symbol.hasInstance]: { value: () => true, configurable: true } });",
  "Reflect.defineProperty(Middle, Symbol.hasInstance, { value: () => true, configurable: true });",
  "Leaf.prototype = Middle.prototype;",
  "Object.setPrototypeOf(Leaf.prototype, Middle.prototype);",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  // In a program without dynamic code the compiler can list all that is linked above a function. Four programs in ten stay so,
  // and keep to the first four things to stand below.
  const isPlain = random.chance(0.4);
  const known = isPlain ? handlers.filter(each => !each.includes("hide(") && !each.includes("word(")) : handlers;
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const link = random.pick(isPlain ? links.filter(each => !each.includes("hide(")) : links).replace("ABOVE", () => random.pick(isPlain ? above.slice(0, 4) : above)); // prettier-ignore
    const steps = random
      .shuffled([
        link,
        isPlain && random.chance(0.5) ? "" : random.pick(known),
        random.chance(0.3) ? random.pick(known) : "",
      ])
      .filter(step => step);
    const text = `function Root(${typed ? "this: any" : ""}) {}
function Middle(${typed ? "this: any" : ""}) {}
function Leaf(${typed ? "this: any" : ""}) {
  this.isOne = this instanceof Leaf;
}
function isLeaf(it${as("unknown")})${as("boolean")} {
  return it instanceof Leaf;
}
function countLeaves(list${as("unknown[]")})${as("number")} {
  let count = 0;
  for (let turn = 0; turn < ${random.pick([1, 100])}; turn++) for (const it of list) if (it instanceof Leaf) count++;
  return count;
}
function asked()${as("string")} {
  const answers${as("unknown[]")} = [];
  try {
    const made = new (Leaf${typed ? " as any" : ""})();
    answers.push(made.isOne, isLeaf(made), isLeaf({}), isLeaf(marked), isLeaf(Object.create(Leaf.prototype)), made instanceof Middle);
    answers.push(countLeaves([made, {}, null, marked, 5]));
    answers.push((Leaf${typed ? " as any" : ""}).call({}), (Leaf${typed ? " as any" : ""})[Symbol.hasInstance] === Function.prototype[Symbol.hasInstance]);
    answers.push(Function.prototype[Symbol.hasInstance].call(Leaf, made));
  } catch (error) {
    answers.push("threw " + ${typed ? "(error as Error)" : "error"}.name);
  }
  return answers.join() + " log " + log.length + " " + log.splice(0)[0];
}
console.log("scene ${scene} at first", asked());
${steps.map((step, at) => `try {\n  ${typed ? step.replaceAll("Leaf.__proto__", "(Leaf as any).__proto__") : step}\n} catch (error) {\n  console.log("scene ${scene} step ${at} threw", ${typed ? "(error as Error)" : "error"}.name);\n}\nconsole.log("scene ${scene} after step ${at}", asked());`).join("\n")}`;
    const named = text.replace(/\b(Root|Middle|Leaf|isLeaf|countLeaves|asked)\b/g, `$1${scene}`);
    // TypeScript wants a type for the parameters of the traps and handlers.
    scenes.push(
      typed
        ? named.replaceAll("SYMBOLS", "(Symbol as any)").replaceAll("(target, name, receiver) =>", "(target: any, name: any, receiver: any) =>").replaceAll("(target, name) =>", "(target: any, name: any) =>").replaceAll("it => it", "(it: any) => it") // prettier-ignore
        : named.replaceAll("SYMBOLS", "Symbol"),
    );
  }
  return `const log${as("string[]")} = [];
const marked = { marked: true };
const word = (text${as("string")})${as("any")} => process.argv[9] ?? text;
${isPlain ? "" : `const hide = new Function("value", process.argv[9] ?? "return value")${typed ? " as <V>(value: V) => V" : ""};`}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
