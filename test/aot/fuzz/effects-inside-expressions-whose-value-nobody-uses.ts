// Small programs of a dozen cases. Each case is a statement whose value nobody uses, and somewhere inside it something happens: the program writes down what happened and prints it behind each case, and each case begins as the first did.
//
//   what happens   a call of a function or a method of the program, a call of what is not there, `count++`, a store, a getter, `new`, `delete`, a tag of a template, a walk over an iterable of the
//                  program, a conversion to a string or a number, the `has` trap of a Proxy
//   beside it      what a build may know and leave out: a member of a built-in object, a constant, a fresh literal, a function or a class that nobody calls, a constant of the program
//   joined by      the comma in either order, `&&`, `||`, `??`, `?:`, `void`, `!`, `typeof`, an operator, a list, an object with the thing as a value or as a key, a template, a member under a key, a call of
//                  a built-in whose answer nobody takes
//   standing       as a statement, in brackets, as the head, the test or the step of a loop, the test of an `if`, a `switch` or a `do`, the body of an arrow function, a default of a parameter or of a
//                  pattern, a static block or a static field of a class that nobody names
//   in             the top of the file, a function that runs once, one that runs in a loop, a method, behind an await, a generator
import type { Random } from "./random";

const happenings: readonly string[] = [
  `say("called")`,
  `say(0)`,
  `say("")`,
  `say(null)`,
  `say(undefined)`,
  `holder.method()`,
  `holder.absent()`,
  `holder.inner.absent.deeper`,
  `missing()`,
  `count++`,
  `--count`,
  `(held = say("stored"))`,
  `(holder.kept = count)`,
  `holder.got`,
  `holder["g" + "ot"]`,
  `new Noted()`,
  `new Noted`,
  `delete holder.gone`,
  "tag`text`",
  `[...walked]`,
  `Math.max(...walked)`,
  "`${converts}`",
  `+converts`,
  `converts == 1`,
  `("key" in trapped)`,
  `trapped.read`,
  `Reflect.get(holder, "got")`,
  `Object.keys(trapped)`,
  `say.call(null, "by call")`,
  `(() => say("in an arrow"))()`,
  `(0, say)("through a comma")`,
  `say?.("if it is there")`,
  `holder.method?.()`,
];

const known: readonly string[] = [
  `Object.keys`,
  `Object.prototype`,
  `Object.prototype.hasOwnProperty`,
  `Math.PI`,
  `Math.max`,
  `Array.prototype.map`,
  `Array.isArray`,
  `JSON`,
  `JSON.stringify`,
  `Symbol.iterator`,
  `Number.MAX_SAFE_INTEGER`,
  `Number.prototype.toFixed`,
  `globalThis.Object`,
  `globalThis`,
  `Reflect.ownKeys`,
  `Promise.resolve`,
  `Promise.prototype.then`,
  `console.log`,
  `console`,
  `String.prototype.at`,
  `Function.prototype`,
  `Error`,
  `Map`,
  `Infinity`,
  `NaN`,
  `undefined`,
  `null`,
  `0`,
  `1`,
  `-1`,
  `""`,
  `"text"`,
  `true`,
  `false`,
  `1n`,
  "`text`",
  `[]`,
  `[1, 2]`,
  `{}`,
  `{ a: 1 }`,
  `() => 0`,
  `function () {}`,
  `class {}`,
  `/x/`,
  `fixed`,
  `fixedText`,
  `say`,
  `holder`,
  `typeof Object`,
  `void 0`,
  `this`,
];

const inBrackets = (text: string) => (/^(?:\{|function|class|\(\) =>)/.test(text) ? `(${text})` : text);

/** `E` is what happens; `K`, `L` and `M` are known. Each gives an expression. */
const joints: readonly ((E: string, K: string, L: string, M: string) => string)[] = [
  (E, K) => `${E}, ${K}`,
  (E, K) => `${inBrackets(K)}, ${E}`,
  (E, K, L) => `${inBrackets(K)}, ${E}, ${L}`,
  (E, K, L) => `${E}, ${K}, ${L}`,
  (E, K) => `(${E}, ${K})`,
  (E, K) => `((${E}), (${K}))`,
  (E, K) => `void (${E}, ${K})`,
  (E, K) => `!(${E}, ${K})`,
  (E, K) => `typeof (${E}, ${K})`,
  (E, K) => `${E} && ${inBrackets(K)}`,
  (E, K) => `${E} || ${inBrackets(K)}`,
  (E, K) => `${E} ?? ${inBrackets(K)}`,
  (E, K) => `${inBrackets(K)} && ${E}`,
  (E, K) => `${inBrackets(K)} || ${E}`,
  (E, K) => `${inBrackets(K)} ?? ${E}`,
  (E, K, L, M) => `(${E}, ${K}) ? ${L} : ${M}`,
  (E, K, L) => `${inBrackets(K)} ? ${E} : ${L}`,
  (E, K, L) => `${inBrackets(K)} ? ${L} : ${E}`,
  (E, K, L) => `${E} ? ${K} : ${L}`,
  (E, K) => `[${E}, ${K}]`,
  (E, K) => `[${K}, ${E}].length`,
  (E, K) => `({ a: ${E}, b: ${K} })`,
  (E, K) => `({ a: ${K}, b: ${E} }).a`,
  // A text: for a symbol as the key of a literal that nothing uses, plain Bun throws (docs/compiler/compatibility.mdx).
  (E, K) => `({ [String(${E})]: ${K} })`,
  (E, K) => `({ ...(${E}, ${K}) })`,
  (E, K) => `[...[(${E}, ${K})]]`,
  (E, K) => "`${" + E + "}${typeof " + inBrackets(K) + "}`",
  (E, K) => `${E} === ${inBrackets(K)}`,
  (E, K) => `${inBrackets(K)} !== ${E}`,
  (E, K) => `(${E}, ${K}) == null`,
  (E, K) => `(${E}, ${K}) instanceof Object`,
  (E, K) => `Object[(${E}, "keys")], ${K}`,
  (E, K) => `(${K})?.[${E}]`,
  (E, K) => `(${E}, ${K})?.absent`,
  (E, K) => `(${E}, Object.keys)({}), ${K}`,
  (E, K) => `Object.keys((${E}, {})), ${K}`,
  (E, K) => `Array.isArray((${E}, ${K}))`,
  (E, K) => `Math.max(1, (${E}, 2)), ${K}`,
  (E, K) => `String((${E}, "text")).length, ${K}`,
  (E, K) => `[(${E}, 1)].map(Number), ${K}`,
  (E, K) => `(${E}, ${K}, Math).PI`,
  (E, K) => `(${inBrackets(K)}, ${E}, Symbol).iterator`,
];

/** Each gives statements around the expression `X`. */
const stands: readonly ((X: string) => string)[] = [
  X => `${/^(?:\{|function|class|\[|\(|`|\+|-)/.test(X) ? ";" : ""}${X};`,
  X => `(${X});`,
  X => `void (${X});`,
  X => `for ((${X}); false; ) {}`,
  X => `for (let turn = 0; turn < 2; turn++, (${X})) {}`,
  X => `for (let turn = 0; ((${X}), turn < 2); turn++) {}`,
  X => `if ((${X})) {\n}`,
  X => `if ((${X})) {\n} else {\n}`,
  X => `if (!(${X})) say("then");\nelse say("else");`,
  X => `switch ((${X})) {\n}`,
  X => `switch (1) {\n  case (${X}):\n}`,
  X => `do {} while (((${X}), false));`,
  X => `while (((${X}), false)) {}`,
  X => `(() => (${X}))();`,
  X => `(() => {\n  ${/^(?:\{|function|class)/.test(X) ? `(${X})` : X};\n})();`,
  X => `((unused = (${X})) => {})();`,
  X => `const [unused = (${X})] = [];`,
  X => `const { unused = (${X}) } = {};`,
  X => `const unused = (${X});`,
  X => `let unused;\nunused = (${X});`,
  X => `(class {\n  static {\n    (${X});\n  }\n});`,
  X => `(class {\n  static unused = (${X});\n});`,
  X => `(class {\n  [(${X})]() {}\n});`,
  X => `named: (${X});`,
  X => `{\n  (${X});\n}`,
  X => `try {\n  (${X});\n} finally {\n  say("finally");\n}`,
  X => `[1].forEach(() => (${X}));`,
  X => `[1].forEach(() => {\n  (${X});\n});`,
];

const indented = (text: string) => text.replace(/^(?=.)/gm, "  ");

/** Each runs the statements `S` of case `n` inside a try that writes down what is thrown. */
const places: readonly ((S: string, n: number) => string)[] = [
  S => `try {\n${indented(S)}\n} catch (error) {\n  log.push(error.name);\n}`,
  (S, n) => `function once${n}() {\n${indented(S)}\n}\nattempt(once${n});`,
  (S, n) => `function often${n}() {\n${indented(S)}\n}\nfor (let run = 0; run < 3; run++) attempt(often${n});`,
  (S, n) => `const arrow${n} = () => {\n${indented(S)}\n};\nattempt(arrow${n});`,
  (S, n) => `class In${n} {\n  method() {\n${indented(indented(S))}\n  }\n}\nattempt(() => new In${n}().method());`,
  (S, n) =>
    `async function later${n}() {\n  await null;\n${indented(S)}\n}\nawait later${n}().catch(error => log.push(error.name));`,
  (S, n) => `function* steps${n}() {\n  yield 1;\n${indented(S)}\n}\nattempt(() => [...steps${n}()]);`,
];

const head = `const log = [];
function say(what) {
  log.push(String(what));
  return what;
}
function attempt(run) {
  try {
    run();
  } catch (error) {
    log.push(error.name);
  }
}
function tag(parts) {
  log.push("tag " + parts[0]);
  return parts;
}
class Noted {
  constructor() {
    log.push("made");
  }
}
let count = 0;
let held;
const fixed = 7;
const fixedText = "fixed";
const makeHolder = () => ({
  inner: {},
  gone: 1,
  method() {
    log.push("method");
    return this;
  },
  get got() {
    log.push("got");
    return 1;
  },
});
let holder = makeHolder();
const walked = {
  *[Symbol.iterator]() {
    log.push("walked");
    yield 1;
  },
};
const converts = {
  [Symbol.toPrimitive](hint) {
    log.push("converted to " + hint);
    return 1;
  },
};
const trapped = new Proxy(
  {},
  {
    has(target, key) {
      log.push("asked for " + String(key));
      return false;
    },
    get(target, key) {
      log.push("read " + String(key));
      return undefined;
    },
    ownKeys() {
      log.push("listed");
      return [];
    },
  },
);
`;

export function generate(random: Random): { file: string; text: string } {
  const cases = Array.from({ length: random.between(8, 16) }, (_, index) => {
    const [K, L, M] = [random.pick(known), random.pick(known), random.pick(known)];
    const expression = random.pick(joints)(random.pick(happenings), K, L, M);
    // Now and then one joint stands inside another.
    const whole = random.chance(0.2) ? random.pick(joints)(`(${expression})`, L, M, K) : expression;
    const text = random.pick(places)(random.pick(stands)(whole), index);
    return `${text}\nconsole.log(${index}, log.join(), count, String(held), Object.keys(holder).join());\nlog.length = 0;\ncount = 0;\nheld = undefined;\nholder = makeHolder();\n`;
  });
  return { file: "main.mjs", text: head + cases.join("") };
}
