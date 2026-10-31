// A caller makes a rest array, an object literal or an array literal for a call. The callee tests something first and may return, throw or call on
// before it touches that argument. Behind the test it keeps, changes, returns, spreads, captures or compares it. The tests have effects of their own,
// and the arguments are evaluated in order whichever way the callee takes. Works as a module and as a CommonJS file, where the functions are sloppy.
import type { Random } from "./random";

const signatures = [
  { parameters: `flag, ...given`, isList: true },
  { parameters: `...given`, isList: true, flag: `given.length & 1` },
  { parameters: `flag, other, ...given`, isList: true },
  { parameters: `flag, given`, isList: false },
  { parameters: `given, flag`, isList: false, givenFirst: true },
  { parameters: `flag, given = { a: -1, b: "default" }`, isList: false },
  { parameters: `flag, given, ...more`, isList: false },
] as const;

const tests = [
  `if (!flag) return "off";`,
  `if (!flag) return;`,
  `if (state.off) return state.reads;`,
  `if (!gate.open) return "closed " + state.reads;`,
  `if (!flag) return fallback(flag);`,
  `if (flag === 0) return "zero";\nstate.between++;\nif (flag === 1) return "one " + state.between;`,
  `if (flag === 2) throw new Error("refused " + state.reads);\nif (!flag) return "off";`,
  `if (typeof flag !== "number") return typeof flag;\nif (flag < 1) return -flag;`,
  `switch (flag) {\ncase 0:\nreturn "none";\ncase 1:\nreturn "single";\n}`,
  `const early = flag ? undefined : "early";\nif (early) return early;`,
  `if (!flag) {\nlog.push("leaves");\nreturn log.length;\n}`,
  `try {\nif (!gate.open) return "closed";\n} catch (error) {\nreturn "caught";\n}`,
  `for (let turn = 0; turn < 2; turn++) state.between++;\nif (!flag) return "after the loop";`,
  `if (!flag) return this === undefined ? "no this" : typeof this;`,
  `if (!flag) return new.target === undefined ? "called" : "constructed";`,
  `if (!flag) return arguments.length;`,
  `const local = { seen: state.reads };\nif (!flag) return "off";\nkept.push(local);`,
  `let counter = 0;\nconst bump = () => ++counter;\nif (!flag) return "off";\nkept.push(bump);\nbump();`,
] as const;

const usesOfLists = [
  `kept.push(given);`,
  `given.push("pushed");`,
  `given.unshift("first");`,
  `given.splice(0, 1);`,
  `given.length = 1;`,
  `given[0] = "stored";`,
  `given[5] = "far";`,
  `log.push("spread " + show([...given]));`,
  `log.push("applied " + show(collect(...given)));`,
  `log.push("applied " + show(collect.apply(null, given)));`,
  `log.push("joined " + given.join("+") + " " + given.length);`,
  `log.push("is array " + Array.isArray(given) + " " + (given instanceof Array) + " " + Object.keys(given).join());`,
  `given.mark = state.reads;`,
  `Object.freeze(given);`,
  `given.reverse();`,
  `log.push("mapped " + show(given.map(one => typeof one)));`,
  `for (const one of given) log.push("each " + show(one));`,
  `const [head, ...tail] = given;\nlog.push("parts " + show(head) + " " + show(tail));`,
] as const;

const usesOfObjects = [
  `kept.push(given);`,
  `given.a = (given.a | 0) + 1;`,
  `given.added = state.reads;`,
  `delete given.a;`,
  `log.push("keys " + Object.keys(given).join());`,
  `log.push("text " + show(given));`,
  `log.push("read " + show(given.a) + " " + show(given.b) + " " + show(given.missing));`,
  `const { a, ...others } = given;\nlog.push("parts " + show(a) + " " + show(others));`,
  `log.push("copy " + show({ ...given, z: 1 }));`,
  `Object.freeze(given);`,
  `Object.defineProperty(given, "hidden", { value: 1, enumerable: false });`,
  `log.push("has " + ("a" in given) + " " + Object.hasOwn(given, "b"));`,
  `for (const key in given) log.push("key " + key);`,
  `log.push("proto " + (Object.getPrototypeOf(given) === Object.prototype));`,
] as const;

const usesOfBoth = [
  `log.push("same " + (given === kept.at(-1)) + " " + (given === given));`,
  `kept.push(() => given);`,
  `holder.field = given;`,
  `log.push("passed " + show(passOn(given)));`,
  `seen.add(given);\nlog.push("seen " + seen.size);`,
  `weak.set(given, state.reads);`,
  `log.push("typeof " + typeof given);`,
  `given = "replaced";`,
  `log.push("arguments " + arguments.length + " " + (arguments[arguments.length - 1] === given));`,
  `log.push("stack " + names(new Error("here")));`,
] as const;

const ends = [
  `return given;`,
  `return "end";`,
  `return passOn(given);`,
  `return [given, given];`,
  `return () => given;`,
  ``,
] as const;

const lists = [
  `note("x", 1), note("y", "two")`,
  `"only"`,
  ``,
  `note("x", i), i + 1, "three", null, undefined`,
  `...spare`,
  `"head", ...spare, "tail"`,
  `{ inner: i }, [i]`,
] as const;
const objects = [
  `{ a: note("a", i), b: note("b", "text") }`,
  `{ a: 1, b: "two" }`,
  `{}`,
  `{ b: "first", a: i }`,
  `{ ...base, a: i }`,
  `{ a: i, get b() {\nstate.reads++;\nreturn "got";\n} }`,
  `{ ["a"]: i, [state.key]: "computed" }`,
  `{ a: { deep: i }, b: [i] }`,
  `[note("a", i), "in a list"]`,
  `{ a: i, b: "text", c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }`,
  `{ __proto__: base, a: i }`,
  `shared`,
] as const;

function callee(
  random: Random,
  index: number,
): { text: string; isList: boolean; givenFirst: boolean; canConstruct: boolean } {
  const signature = random.pick(signatures);
  const uses = signature.isList ? usesOfLists : usesOfObjects;
  const body: string[] = [];
  if ("flag" in signature) body.push(`const flag = ${signature.flag};`);
  body.push(random.pick(tests));
  if (random.chance(0.2)) body.push(random.pick(tests.filter(test => !/^(const|let) /m.test(test))));
  for (let count = random.between(1, 4); count--;)
    body.push(guarded(random.chance(0.35) ? random.pick(usesOfBoth) : random.pick(uses)));
  // Enough text that the callee stays a call.
  if (random.chance(0.6))
    for (let line = 0; line < 12; line++) body.push(`log.push("line ${line} " + state.reads + " " + kept.length);`);
  body.push(random.pick(ends));
  const text = body.join("\n");
  const isArrow = random.chance(0.2) && !/\bthis\b|\barguments\b|new\.target/.test(text);
  const isMethod = !isArrow && random.chance(0.2) && !text.includes("new.target");
  const head = isArrow
    ? `const callee${index} = (${signature.parameters}) => {`
    : isMethod
      ? `const callee${index} = { callee${index}(${signature.parameters}) {`
      : `function callee${index}(${signature.parameters}) {`;
  const tail = isArrow ? `};` : isMethod ? `} }.callee${index};` : `}`;
  return {
    text: `${head}\n${text}\n${tail}`,
    isList: signature.isList,
    givenFirst: "givenFirst" in signature,
    canConstruct: !isArrow && !isMethod,
  };
}

function guarded(line: string): string {
  return `try {\n${line}\n} catch (error) {\nlog.push("threw " + error.name);\n}`;
}

export function generate(random: Random, isCommonJs = false): string {
  const count = random.between(1, 4);
  const callees = Array.from({ length: count }, (_, index) => callee(random, index));
  const calls: string[] = [];
  for (let call = random.between(1, 5); call--;) {
    const index = random.below(count);
    const chosen = callees[index]!;
    const flag = random.pick([
      `i % ${random.between(2, 7)}`,
      `i & 1`,
      `0`,
      `1`,
      `i % 50 === 0 ? 3 : 0`,
      `i > 150 ? 3 : 0`,
      `"text"`,
      `note("flag", i % 3)`,
    ]);
    const given = chosen.isList ? random.pick(lists) : random.pick(objects);
    const list = (chosen.givenFirst ? [given, flag] : [flag, given]).filter(Boolean).join(", ");
    const name = `callee${index}`;
    const form = random.pick([
      `${name}(${list})`,
      `${name}(${list})`,
      `${name}(${list})`,
      `table[${index}](${list})`,
      `table[i % table.length](${list})`,
      `${name}.call(holder, ${list})`,
      `${name}.apply(null, [${list}])`,
      `${name}.bind(null)(${list})`,
      `Reflect.apply(${name}, undefined, [${list}])`,
      ...(chosen.canConstruct ? [`new ${name}(${list})`] : []),
      `[1].map(() => ${name}(${list}))[0]`,
      `(() => ${name}(${list}))()`,
    ]);
    calls.push(
      `try {\nlog.push("result " + show(${form}));\n} catch (error) {\nlog.push("call threw " + error.message + " " + names(error));\n}`,
    );
  }
  const rounds = random.weighted([
    [3, 3],
    [3, 40],
    [2, 400],
  ] as const);
  return `const log = [];
const kept = [];
const order = [];
const holder = { field: null };
const seen = new Set();
const weak = new WeakMap();
const base = { a: "base a", inherited: true };
const shared = { a: 0, b: "shared" };
const spare = ["s1", "s2"];
const state = { off: false, reads: 0, between: 0, key: "k" };
const gate = {
  get open() {
    state.reads++;
    return state.reads % ${random.between(2, 5)} !== 0;
  },
};
function note(name, value) {
  order.push(name);
  return value;
}
function show(value, depth = 0) {
  if (typeof value === "function") return "function " + (depth < 2 ? show(attempt(value), depth + 1) : "");
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (error) {
    return "unprintable";
  }
}
function attempt(f) {
  try {
    return f();
  } catch (error) {
    return "threw " + error.name;
  }
}
function names(error) {
  return String(error.stack)
    .split("\\n")
    .slice(1, 4)
    .map(line => (/^\\s*at (\\S+) \\(/.exec(line)?.[1] ?? "-") + (/:\\d+:\\d+\\)?$/.exec(line)?.[0] ?? ""))
    .join(">");
}
function fallback(value) {
  state.between++;
  return "fallback " + value;
}
function collect(...all) {
  return all.length + ":" + all.join("/");
}
function passOn(value) {
  if (state.reads % 3 === 0) kept.push(value);
  return value;
}
${callees.map(one => one.text).join("\n")}
const table = [${callees.map((_, index) => `callee${index}`).join(", ")}];
let digest = 0;
function fold(text) {
  for (let at = 0; at < text.length; at++) digest = (digest * 31 + text.charCodeAt(at)) | 0;
}
for (let i = 0; i < ${rounds}; i++) {
state.off = i % ${random.between(2, 6)} === 0;
${calls.join("\n")}
if (i < 3 || i === ${rounds - 1}) console.log(log.join(" | "));
fold(log.join("|") + order.join(""));
log.length = 0;
order.length = 0;
if (kept.length > 50) {
fold(kept.map(one => show(one)).join());
kept.length = 0;
}
}
console.log(digest, state.reads, state.between, show(kept.slice(0, 5)), show(holder.field), seen.size, show(shared));
${isCommonJs ? "module.exports = digest;\n" : "export {};\n"}`;
}
