// A function makes a value, mostly an instance of one of the program's classes, keeps it in a local and throws it on one of many roads: straight,
// through calls, callbacks of built-ins, accessors, conversions, proxies, iterators, generators, constructors, finally blocks, rejected promises.
// Where it is caught it is tested, read, changed, given other kinds of values in its fields, and kept. Behind the catch the function reads the
// value again through its own local. Every step writes down what it saw.
import type { Random } from "./random";

const makers = [
  `new Plain(turn)`,
  `new Plain(turn)`,
  `new Below(turn)`,
  `new Below(turn)`,
  `new Failure(turn)`,
  `new Hidden(turn)`,
  `new Lone(turn)`,
  `{ count: turn, label: "literal" }`,
  `[turn, "in a list"]`,
  `turn`,
  `"text " + turn`,
  `null`,
  `undefined`,
  `() => turn`,
  `Symbol.for("thrown")`,
  `new Proxy(new Plain(turn), {})`,
  `Object.create(Plain.prototype)`,
  `Object.freeze(new Plain(turn))`,
  `Object.seal(new Below(turn))`,
  `new TypeError("made")`,
  `new Map([["count", turn]])`,
  `new Uint8Array([turn])`,
] as const;

const roads = [
  `throw held;`,
  `thrower(held);`,
  `deep(held, 6);`,
  `[1].forEach(() => {\nthrow held;\n});`,
  `[1].map(() => thrower(held));`,
  `[2, 1].sort(() => {\nthrow held;\n});`,
  `[1].reduce(() => {\nthrow held;\n}, 0);`,
  `[1].find(() => thrower(held));`,
  `Array.from([1], () => {\nthrow held;\n});`,
  `Array.from({ length: 1, get 0() {\nthrow held;\n} });`,
  `new Map([[1, 1]]).forEach(() => {\nthrow held;\n});`,
  `new Set([1]).forEach(() => thrower(held));`,
  `({ get member() {\nthrow held;\n} }).member;`,
  `({ set member(value) {\nthrow value;\n} }).member = held;`,
  `String({ toString() {\nthrow held;\n} });`,
  `\`\${{ toString() {\nthrow held;\n} }}\`;`,
  `+{ valueOf() {\nthrow held;\n} };`,
  `({ [Symbol.toPrimitive]() {\nthrow held;\n} }) + 1;`,
  `({})[{ toString() {\nthrow held;\n} }];`,
  `new Proxy({}, { get() {\nthrow held;\n} }).member;`,
  `new Proxy({}, { has() {\nthrow held;\n} }), "member" in new Proxy({}, { has() {\nthrow held;\n} });`,
  `Object.keys(new Proxy({}, { ownKeys() {\nthrow held;\n} }));`,
  `new Proxy(function () {}, { apply() {\nthrow held;\n} })();`,
  `JSON.parse("[1]", () => {\nthrow held;\n});`,
  `JSON.stringify({ toJSON() {\nthrow held;\n} });`,
  `for (const each of { [Symbol.iterator]() {\nreturn { next() {\nthrow held;\n} };\n} }) lines.push("never");`,
  `for (const each of { [Symbol.iterator]() {\nreturn { next: () => ({ done: false, value: 1 }), return() {\nthrow held;\n} };\n} }) break;`,
  `const [first] = { [Symbol.iterator]() {\nthrow held;\n} };`,
  `[...(function* () {\nthrow held;\n})()];`,
  `const walker = (function* () {\nyield 1;\n})();\nwalker.next();\nwalker.throw(held);`,
  `const walker = (function* () {\ntry {\nyield 1;\n} catch (inside) {\nlines.push("inside " + (inside === held));\nthrow inside;\n}\n})();\nwalker.next();\nwalker.throw(held);`,
  `const walker = (function* () {\ntry {\nyield 1;\n} finally {\nthrow held;\n}\n})();\nwalker.next();\nwalker.return(0);`,
  `new (class {\nconstructor() {\nthrow held;\n}\n})();`,
  `new (class {\nfield = thrower(held);\n})();`,
  `(class {\nstatic {\nthrow held;\n}\n});`,
  `(class {\nstatic field = thrower(held);\n});`,
  `(class extends Plain {\nconstructor() {\nsuper(thrower(held));\n}\n}), new (class extends Plain {\nconstructor() {\nsuper(thrower(held));\n}\n})();`,
  `Reflect.apply(thrower, undefined, [held]);`,
  `Reflect.construct(function () {\nthrow held;\n}, []);`,
  `thrower.call(undefined, held);`,
  `thrower.apply(undefined, [held]);`,
  `thrower.bind(undefined, held)();`,
  `"a".replace(/a/, () => {\nthrow held;\n});`,
  `"a".replace("a", () => thrower(held));`,
  `tagged\`\${held}\`;`,
  `try {\nthrow held;\n} finally {\nlines.push("finally");\n}`,
  `try {\nthrow held;\n} catch (inner) {\nthrow inner;\n}`,
  `try {\nthrow 0;\n} catch {\nthrow held;\n}`,
  `try {\nthrow 0;\n} finally {\nthrow held;\n}`,
  `try {\nthrower(held);\n} catch (inner) {\nif (inner !== held) lines.push("another");\nthrow inner;\n} finally {\nlines.push("finally");\n}`,
  `{\nusing guard = { [Symbol.dispose]() {\nthrow held;\n} };\n}`,
  `(turn >= 0 ? thrower : String)(held);`,
  `table[key("thrower")](held);`,
  `nobody(1) && thrower(held);`,
  `(0, eval)("(value => { throw value; })")(held);`,
  `new Function("value", "throw value;")(held);`,
  `structuredClone({ get member() {\nthrow held;\n} });`,
  `Object.assign({}, { get member() {\nthrow held;\n} });`,
  `({ ...{ get member() {\nthrow held;\n} } });`,
  `Object.defineProperty({}, "member", { get value() {\nthrow held;\n} });`,
  `emitter.once("thrown", thrower);\nemitter.emit("thrown", held);`,
] as const;

const awaitedRoads = [
  `await Promise.reject(held);`,
  `await (async () => {\nthrow held;\n})();`,
  `await (async () => {\nawait null;\nthrow held;\n})();`,
  `await new Promise((_, reject) => reject(held));`,
  `await new Promise(() => {\nthrow held;\n});`,
  `await new Promise((_, reject) => setTimeout(reject, 0, held));`,
  `await new Promise((_, reject) => queueMicrotask(() => reject(held)));`,
  `await Promise.resolve().then(() => {\nthrow held;\n});`,
  `await Promise.resolve(held).then(thrower);`,
  `await Promise.reject(held).finally(() => lines.push("finally"));`,
  `await Promise.reject(held).catch(thrower);`,
  `await Promise.reject(0).catch(() => thrower(held));`,
  `await { then(_, reject) {\nreject(held);\n} };`,
  `await { then() {\nthrow held;\n} };`,
  `await { get then() {\nthrow held;\n} };`,
  `await Promise.all([1, Promise.reject(held)]);`,
  `await Promise.race([Promise.reject(held)]);`,
  `await Promise.try(thrower, held);`,
  `for await (const each of (async function* () {\nthrow held;\n})()) lines.push("never");`,
  `for await (const each of [Promise.reject(held)]) lines.push("never");`,
  `const walker = (async function* () {\nyield 1;\n})();\nawait walker.next();\nawait walker.throw(held);`,
  `await Array.fromAsync([1], () => {\nthrow held;\n});`,
] as const;

const uses = [
  `tell("kind", () => typeof caught);`,
  `tell("same", () => caught === held);`,
  `tell("classes", () => [caught instanceof Plain, caught instanceof Below, caught instanceof Failure, caught instanceof Hidden, caught instanceof Error].join());`,
  `tell("count", () => caught.count);`,
  `tell("label", () => caught?.label);`,
  `tell("bump", () => caught.bump());`,
  `tell("bump", () => caught?.bump?.());`,
  `tell("hidden", () => caught.hidden);`,
  `tell("poke", () => caught.poke());`,
  `tell("static", () => Hidden.reads(caught));`,
  `tell("text in a number", () => (caught.count = "text"));`,
  `tell("half in a whole number", () => (caught.count += 0.5));`,
  `tell("large", () => (caught.count = 2 ** 40));`,
  `tell("nothing in a field", () => (caught.extra = undefined));`,
  `tell("object in a field", () => typeof (caught.label = { inner: 1 }));`,
  `tell("removed", () => delete caught.label);`,
  `tell("removed", () => delete caught.count);`,
  `tell("added", () => (caught.added = turn));`,
  `tell("index", () => (caught[0] = "at zero"));`,
  `tell("accessor", () => typeof Object.defineProperty(caught, "count", { get: () => 7, configurable: true }));`,
  `tell("constant", () => typeof Object.defineProperty(caught, "label", { value: "fixed", writable: false }));`,
  `tell("other parent", () => typeof Object.setPrototypeOf(caught, Lone.prototype));`,
  `tell("no parent", () => typeof Object.setPrototypeOf(caught, null));`,
  `tell("frozen", () => typeof Object.freeze(caught));`,
  `tell("closed", () => typeof Object.preventExtensions(caught));`,
  `tell("list", () => caught.list.push("pushed"));`,
  `tell("assigned", () => typeof Object.assign(caught, { count: "assigned", more: 1 }));`,
  `tell("own method", () => typeof (caught.bump = () => "own"));`,
  `kept.push(caught);`,
  `globalThis[key("kept")] = caught;`,
  `nobody(caught);`,
  `tell("keys", () => Object.keys(caught).join());`,
  `tell("copy", () => Object.keys({ ...caught }).join());`,
  `tell("taken apart", () => {\nconst { count, label } = caught;\nreturn typeof count + " " + typeof label;\n});`,
] as const;

const after = [
  `tell("then", () => show(held));`,
  `tell("then count", () => held.count);`,
  `tell("then sum", () => held.count + 1);`,
  `tell("then label", () => held.label + "!");`,
  `tell("then extra", () => held.extra * 2);`,
  `tell("then bump", () => held.bump());`,
  `tell("then hidden", () => held.hidden);`,
  `tell("then keys", () => Object.keys(held).join());`,
  `tell("then kept", () => kept.at(-1) === held);`,
  `tell("then class", () => held instanceof Plain);`,
] as const;

export function generate(random: Random): string {
  const count = random.between(2, 6);
  const scenarios: string[] = [];
  const calls: string[] = [];
  for (let index = 0; index < count; index++) {
    const isAsync = random.chance(0.4);
    const road = isAsync && random.chance(0.7) ? random.pick(awaitedRoads) : random.pick(roads);
    const used = Array.from({ length: random.between(1, 5) }, () => random.pick(uses)).join("\n");
    const then = Array.from({ length: random.between(1, 3) }, () => random.pick(after)).join("\n");
    const before = random.chance(0.4) ? `tell("before", () => show(held));\n` : "";
    const catcher = random.weighted([
      [6, `try {\n${road}\nlines.push("not thrown");\n} catch (caught) {\n${used}\n}`],
      [1, `try {\ntry {\n${road}\n} finally {\nlines.push("on the way");\n}\n} catch (caught) {\n${used}\n}`],
      [
        1,
        `try {\ntry {\n${road}\n} catch (first) {\nkept.push(first);\nthrow first;\n}\n} catch (caught) {\n${used}\n}`,
      ],
      [1, `const caught = caughtOf(() => {\n${isAsync ? "thrower(held);" : road}\n});\n${used}`],
      [isAsync ? 2 : 0, `await (async () => {\n${road}\n})().catch(caught => {\n${used}\n});`],
      [isAsync ? 1 : 0, `await (async () => {\n${road}\n})().then(undefined, caught => {\n${used}\n});`],
    ]);
    scenarios.push(
      `${isAsync ? "async " : ""}function scenario${index}(turn) {\nconst held = ${random.pick(makers)};\n${before}${catcher}\n${then}\n${random.chance(0.3) ? "return held;" : ""}\n}`,
    );
    calls.push(`${isAsync ? "await " : ""}scenario${index}(turn);`);
  }
  return `import { EventEmitter } from "node:events";
const lines = [];
const kept = [];
const emitter = new EventEmitter();
const key = name => process.argv[9] ?? name;
const nobody = globalThis[process.argv[2] ?? "Boolean"];
class Plain {
constructor(count) {
this.count = count;
this.label = "plain " + count;
}
bump() {
return ++this.count;
}
}
class Below extends Plain {
constructor(count) {
super(count);
this.extra = count * 0.5;
}
bump() {
return (this.count += 2);
}
}
class Failure extends Error {
constructor(count) {
super("failure");
this.count = count;
}
}
class Hidden {
#hidden = 1;
constructor(count) {
this.list = [count];
}
get hidden() {
return this.#hidden;
}
poke() {
return ++this.#hidden;
}
static reads(value) {
return #hidden in value ? value.#hidden : "no such field";
}
}
class Lone {
constructor(count) {
this.count = count;
}
bump() {
return "lone";
}
}
function show(value) {
if (typeof value === "function") return "function";
if (typeof value === "symbol") return "symbol";
if (typeof value !== "object" || value === null) return String(value);
const parent = Object.getPrototypeOf(value);
const parts = Object.keys(value).map(name => {
const inner = value[name];
return name + "=" + (typeof inner === "object" && inner !== null ? "object" : typeof inner === "function" ? "function" : String(inner));
});
return (parent === null ? "null" : parent.constructor.name) + "{" + parts.join() + "}";
}
function tell(label, run) {
try {
lines.push(label + ": " + show(run()));
} catch (error) {
lines.push(label + ": threw " + (error instanceof Error ? error.constructor.name : show(error)));
}
}
function thrower(value) {
throw value;
}
function deep(value, depth) {
if (depth === 0) throw value;
return deep(value, depth - 1) + 1;
}
function tagged(parts, value) {
throw value;
}
function caughtOf(run) {
try {
run();
} catch (caught) {
return caught;
}
}
const table = { thrower };
${scenarios.join("\n")}
for (let turn = 0; turn < ${random.pick([1, 2, 5, 60])}; turn++) {
${calls.join("\n")}
if (kept.length > 8) kept.length = 0;
}
console.log([...new Set(lines)].join("\\n"));
`;
}
