// A helper object has a method that defines a closure on a target under a key it is handed, and the calls hand it written names. A program draws
// how the helper object is made, how the method calls itself or its neighbours, what stands between the read of a field and its first use, how the
// member is defined, the keys and how deep the calls go. It prints every member of the target with its name, length and result, how often the
// method ran, which members are one closure, and all of that again after the method was replaced.
import type { Random } from "./random";

type Method = [name: string, parameters: string, body: string];

const holders: Record<string, (methods: Method[]) => string> = {
  "literal": m => `const helper = { calls: 0, tag: "h", ${m.map(([n, p, b]) => `${n}(${p}) { ${b} }`).join(", ")} };`,
  "function-members": m => `const helper = { calls: 0, tag: "h", ${m.map(([n, p, b]) => `${n}: function (${p}) { ${b} }`).join(", ")} };`,
  "frozen": m => `const state = { calls: 0 }; const helper = Object.freeze({ get calls() { return state.calls; }, set calls(v) { state.calls = v; }, tag: "h", ${m.map(([n, p, b]) => `${n}(${p}) { ${b} }`).join(", ")} });`,
  "class-instance": m => `class Helper { calls = 0; tag = "h"; ${m.map(([n, p, b]) => `${n}(${p}) { ${b} }`).join(" ")} } const helper = new Helper();`,
  "class-static": m => `class helper { static calls = 0; static tag = "h"; ${m.map(([n, p, b]) => `static ${n}(${p}) { ${b} }`).join(" ")} }`,
  "prototype": m => `function Helper() { this.calls = 0; this.tag = "h"; } ${m.map(([n, p, b]) => `Helper.prototype.${n} = function (${p}) { ${b} };`).join(" ")} const helper = new Helper();`,
  "object-create": m => `const helper = Object.create({ ${m.map(([n, p, b]) => `${n}(${p}) { ${b} }`).join(", ")} }); helper.calls = 0; helper.tag = "h";`,
  "subclass": m => `class Base { calls = 0; tag = "h"; ${m.map(([n, p, b]) => `${n}(${p}) { ${b} }`).join(" ")} } class Helper extends Base { define(target, key, depth) { return super.define(target, key, depth); } } const helper = new Helper();`,
};

// HEAD reads the field and counts the call; DEFINE(target, key) defines the closure.
const recursions: Record<string, Method[]> = {
  "none": [["define", "target, key, depth", `HEAD DEFINE(target, key); return target;`]],
  "itself-behind": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) this.define(target, key, depth - 1); return target;`]],
  "itself-in-front": [["define", "target, key, depth", `HEAD if (depth > 0) this.define(target, key, depth - 1); DEFINE(target, key); return target;`]],
  "itself-with-another-written-name": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) this.define(target, "inner", depth - 1); return target;`]],
  "itself-with-a-grown-name": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) this.define(target, String(key) + "_", depth - 1); return target;`]],
  "two-methods": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) this.again(target, key, depth - 1); return target;`], ["again", "target, key, depth", `this.calls += 10; return this.define(target, key, depth);`]],
  "three-methods": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) this.second(target, key, depth - 1); return target;`], ["second", "target, key, depth", `return [this.third(target, key, depth)][0];`], ["third", "target, key, depth", `this.calls += 100; return [this.define(target, key, depth)][0];`]],
  "by-the-helper's-name": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) helper.define(target, key, depth - 1); return target;`]],
  "by-call": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) this.define.call(this, target, key, depth - 1); return target;`]],
  "by-a-read": [["define", "target, key, depth", `HEAD DEFINE(target, key); const next = this.define; if (depth > 0) next.call(this, target, key, depth - 1); return target;`]],
  "in-a-callback": [["define", "target, key, depth", `HEAD DEFINE(target, key); [depth].forEach(d => { if (d > 0) this.define(target, key, d - 1); }); return target;`]],
  "twice": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) { this.define(target, key, depth - 1); this.define(target, String(key) + "2", depth - 1); } return target;`]],
  "from-the-closure": [["define", "target, key, depth", `HEAD DEFINE(target, key); if (depth > 0) target.later = () => helper.define(target, key, depth - 1) === target; return target;`]],
};

const heads: Record<string, [head: string, extra: string]> = {
  "nothing": [`const tag = this.tag; const mine = ++this.calls;`, `tag`],
  "a-constant": [`const tag = this.tag; const seven = 7; const mine = ++this.calls;`, `tag + seven`],
  "a-closure-that-captures-nothing": [`const tag = this.tag; const plain = function () { return "p"; }; const mine = ++this.calls;`, `tag + plain()`],
  "both-and-a-second-field": [`const tag = this.tag; const before = this.calls; const plain = () => 3; const nine = 9; const mine = ++this.calls;`, `tag + before + plain() + nine`],
};

const closure = (extra: string) => `function (more) { return String(key) + ":" + mine + ":" + depth + ":" + (${extra}) + ":" + more; }`;
const definitions: Record<string, (target: string, key: string, closure: string) => string> = {
  "store": (t, k, f) => `${t}[${k}] = ${f};`,
  "define-value": (t, k, f) => `Object.defineProperty(${t}, ${k}, { value: ${f}, writable: true, configurable: true, enumerable: true });`,
  "define-getter": (t, k, f) => `Object.defineProperty(${t}, ${k}, { get() { return ${f}; }, configurable: true, enumerable: true });`,
  "assign-computed": (t, k, f) => `Object.assign(${t}, { [${k}]: ${f} });`,
};

const keys: Record<string, string[]> = {
  "written": [`"alpha"`, `"beta"`, `"gamma"`],
  "one-name-twice": [`"alpha"`, `"beta"`, `"alpha"`],
  "written-and-unknown": [`"alpha"`, `unknown[0]`, `"inner"`],
  "odd-names": [`"constructor"`, `"later"`, `"0"`],
};

const depths = [0, 1, 2, 3, 4, 6];

export function generate(random: Random): string {
  const holder = random.pick(Object.values(holders));
  const methods = random.pick(Object.values(recursions));
  const [head, extra] = random.pick(Object.values(heads));
  const definition = random.pick(Object.values(definitions));
  const names = random.pick(Object.values(keys));
  const depth = random.pick(depths);
  const filled = methods.map(
    ([name, parameters, body]): Method => [
      name,
      parameters,
      body.replace("HEAD", head).replace("DEFINE(target, key);", definition("target", "key", closure(extra))),
    ],
  );
  return `const unknown = [String.fromCharCode(100 + (Date.now() > 0 ? 1 : 2)) + "ta"];
${holder(filled)}
const target = { present: "was here" };
try {
${names.map(name => `helper.define(target, ${name}, ${depth});`).join("\n")}
function show(label) {
  for (const key of Reflect.ownKeys(target)) {
    const value = target[key];
    console.log(label, String(key), typeof value, typeof value === "function" ? value.name + "/" + value.length + "/" + value("m") : value);
  }
  console.log(label, "calls", helper.calls, target.alpha === target.beta, target.alpha === target.alpha, Object.keys(target).join());
}
show("first");
if (typeof target.later === "function" && target.later.length === 0) { console.log("later", target.later()); show("later"); }
const second = {};
console.log("same target", helper.define(second, "alpha", 1) === second, second.alpha === target.alpha, second.alpha("n"));
try {
  const old = helper.define;
  helper.define = function (target, key, depth) { target[key] = "replaced " + depth; return old.call(this, target, String(key) + "!", 0); };
  helper.define(target, "alpha", ${depth});
  helper.define(target, "delta", ${depth});
} catch (error) {
  console.log("change refused", error.constructor.name);
}
show("changed");
} catch (error) {
  console.log("threw", error.constructor.name, error.message);
}
`;
}
