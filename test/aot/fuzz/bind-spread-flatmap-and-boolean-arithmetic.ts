// Five everyday idioms, each run many times at one place in the code, with something unusual arriving in the middle of the run.
//
//   bind       `this.method = this.method.bind(this)` in a constructor; later the method is replaced, renamed, overridden, a getter, a proxy ..
//   spread     `[...list]`, `f(...list)`, `push(...list)` of integers, doubles, boxed numbers, holes, subclasses, own iterators ..
//   flatMap    callbacks that return pairs, nothing, holes, proxies, array-likes, or that change the list they walk
//   booleans   `+flag`, `Number(flag)`, `count += flag`, `-flag`, `list[+flag]` .. of booleans, and of null, undefined and numbers at the same place
//   getters    an empty object gets getters under computed keys; the same names are stored to other objects, some of them on its prototype chain
//
// Each scene prints its first turns, the turns around the change, its last turn, and a hash of every turn.
import type { Random } from "./random";

export function generate(r: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const cast = (text: string) => (typed ? `(${text} as any)` : text);
  const numbers = typed ? ": number[]" : "";

  // Lists. `plain` ones hold numbers only and keep the built-in iterator.
  const plainLists = [
    `[1, 2, 3]`,
    `[1.5, 2.5, -0]`,
    `[turn, turn + 1, turn + 2]`,
    `[turn + 0.5, NaN, -0, 1e300]`,
    `boxed(turn)`,
    `boxed(turn + 0.5)`,
    `grown(${r.pick([0, 1, 5, 40, 200])}, 1)`,
    `grown(${r.pick([3, 40, 200])}, 0.5)`,
    `shifted(${r.pick([130, 200, 400])}, ${r.pick(["1", "0.5"])})`,
    `[]`,
    `Object.freeze([4, 5, 6])`,
  ];
  const holeyLists = [
    cast(`[1, , 3]`),
    cast(`[1.5, , NaN, , -0]`),
    cast(`new Array(${r.pick([1, 3, 9])})`),
    `withHole(boxed(turn))`,
    `withHole(grown(6, 0.5))`,
    `longer(grown(3, 1))`,
    `sparse(${r.pick([50, 1200, 5000])})`,
  ];
  const oddLists = [
    `below(${cast("[1, , 3]")})`,
    `below(withHole(grown(5, 0.5)))`,
    `ownIterator([1, 2, 3])`,
    `Sub.from([1, 2, 3])`,
    `Walks.from([1, 2, 3])`,
    `getterAt([1, 2, 3, 4])`,
    `["a", 1, null, undefined, { k: 1 }]`,
    `[[1], [2, [3]], []]`,
    `new Proxy([1, 2, 3], {})`,
  ];
  const iterables = [`new Set([1, 1, 2])`, `"a\\u{1F600}b"`, `new Uint8Array([7, 8])`, `new Map([[1, 2]]).keys()`, `argumentsOf(1, 2.5, "x")`]; // prettier-ignore
  const notIterable = [`null`, `undefined`, `5`, `{ length: 2, 0: "a", 1: "b" }`];
  const usual = () => r.pick(plainLists);
  const unusual = (more: string[] = []) =>
    r.pick([...holeyLists, ...holeyLists, ...oddLists, ...oddLists, ...plainLists, ...more]);

  const scenes: string[] = [];
  const count = 3 + r.below(4);
  for (let n = 0; n < count; n++) {
    const turns = r.pick([12, 40, 40, 150, 600]);
    const change = r.pick([1, 2, turns >> 1, turns >> 1, turns - 2]);
    const back = r.chance(0.5) ? change + 1 + r.below(3) : turns;
    const isChanged = `(turn >= ${change} && turn < ${back})`;
    let before = "";
    const body: string[] = [];
    const family = r.pick([
      "bind",
      "bind",
      "spread",
      "spread",
      "flatMap",
      "flatMap",
      "booleans",
      "booleans",
      "getters",
    ]);

    if (family === "bind") {
      const extra = r.pick([
        "this",
        "this",
        "this",
        "this",
        "this, 1",
        'this, turn, "x"',
        "null",
        "undefined",
        "5",
        "other",
        "",
      ]);
      const method = `m(a${any}, b${any})${any} { return [this === undefined || this === null ? "none" : ${cast("this")}.v, a, b]; }`;
      const shape = r.pick(["class", "class", "class", "subclass", "function", "field"]);
      const bindLine = `this.m = ${extra === "" ? cast("this.m") : "this.m"}.bind(${extra});`;
      if (shape === "function") {
        before = `function A${n}(${typed ? "this: any, " : ""}v${any}, turn${any}) { this.v = v; ${bindLine} }
A${n}.prototype.m = function m(${typed ? "this: any, " : ""}a${any}, b${any}) { return [this === undefined || this === null ? "none" : this.v, a, b]; };
const B${n} = A${n};`;
      } else {
        before = `class A${n} {
  ${typed ? "v: any;\n  " : ""}${shape === "field" ? `n${any} = 1;\n  ` : ""}constructor(v${any}, turn${any}) { this.v = v; ${bindLine} }
  ${method}
}
${
  shape === "subclass"
    ? `class B${n} extends A${n} { m(a${any}, b${any})${any} { return ["sub", super.m(a, b)]; } }`
    : `const B${n} = A${n};`
}`;
      }
      const proto = cast(`A${n}.prototype`);
      const changes = [
        `${proto}.m = function replaced(${typed ? "this: any, " : ""}a${any}) { return ["replaced", this && this.v, a]; };`,
        `${proto}.m = (a${any}) => ["arrow", a];`,
        `${proto}.m = ${proto}.m.bind({ v: "bound before" });`,
        `${proto}.m = Math.max;`,
        `${proto}.m = class Inner { ${typed ? "a: any; " : ""}constructor(a${any}) { this.a = a; } };`,
        `${proto}.m = new Proxy(function proxied(a${any}) { return ["proxied", a]; }, {});`,
        `${proto}.m = Object.assign(function own(a${any}) { return ["own", a]; }, { bind(self${any}) { return () => ["its own bind", self && self.v]; } });`,
        `${proto}.m = { bind(self${any}) { return () => ["bind of an object", self && self.v]; } };`,
        `Object.defineProperty(${proto}.m, "name", { value: "renamed", configurable: true });`,
        `Object.defineProperty(${proto}.m, "length", { value: 7, configurable: true });`,
        `${proto}.m = function* steps(a${any}) { yield a; yield 2; };`,
        `${proto}.m = async function later(a${any}) { return a; };`,
        `Object.defineProperty(${proto}, "m", { get() { return function got(${typed ? "this: any, " : ""}a${any}) { return ["got", this && this.v, a]; }; }, set(value) { Object.defineProperty(this, "m", { value, writable: true, configurable: true }); }, configurable: true });`,
        `Object.defineProperty(${proto}, "m", { get() { return function got(a${any}) { return ["got", a]; }; }, configurable: true });`,
        `Object.setPrototypeOf(${proto}.m, null);`,
        `Object.setPrototypeOf(${proto}.m, { bind() { return () => "bind found higher up"; } });`,
        `${proto}.m = undefined;`,
        `${proto}.m = function loose(${typed ? "this: any, " : ""}a${any}) { return [typeof this, a]; };`,
      ];
      const uses = [
        `out.push(show(o.m(turn, 2)));`,
        `{ const f = o.m; out.push(show(f(turn))); }`,
        `out.push(show([1, 2].map(o.m)));`,
        `out.push(show(o.m.call({ v: "ignored" }, 1)));`,
        `out.push(show(o.m.apply(null, [1, 2, 3])));`,
        `out.push(o.m.name + "/" + o.m.length);`,
        `out.push(String("prototype" in o.m) + typeof o.m + Object.getOwnPropertyNames(o.m).sort().join());`,
        `out.push(show(o.m.bind(null, 9)(8)));`,
        `out.push(show(Reflect.apply(o.m, 5, [1])));`,
        `out.push(show(call(o.m, turn)));`,
        `out.push(show(call(turn % 5 === 4 ? (a${any}) => ["not bound", a] : o.m, turn)));`,
        `out.push(String(Object.hasOwn(o, "m")) + String(o.m === ${proto}.m));`,
        `try { out.push(show(new o.m(1))); } catch (e${any}) { out.push("new: " + e.constructor.name); }`,
        `try { out.push(String(o instanceof o.m)); } catch (e${any}) { out.push("instanceof: " + e.constructor.name); }`,
        `kept${n}.push(o.m); if (kept${n}.length > 3) out.push(show(kept${n}.shift()(turn)));`,
      ];
      before += `\nconst kept${n}${typed ? ": any[]" : ""} = [];\nconst first${n} = ${proto}.m;`;
      body.push(`if (turn === ${change}) { ${r.pick(changes)} }`);
      if (back < turns) body.push(`if (turn === ${back}) { delete ${proto}.m; ${proto}.m = first${n}; }`);
      body.push(`const o${any} = new ${cast(`(turn % 3 === 2 ? B${n} : A${n})`)}(turn, turn);`);
      for (let k = 2 + r.below(4); k > 0; k--) body.push(r.pick(uses));
    } else if (family === "spread") {
      const odd = unusual([...iterables, ...iterables, ...notIterable]);
      body.push(`const list${any} = ${isChanged} ? ${odd} : ${usual()};`);
      const isTyped = typed && r.chance(0.6);
      before = `function copy${n}(list${isTyped ? ": number[]" : any})${isTyped ? ": number[]" : any} { return [...list]; }`;
      const uses = [
        `{ const copy${any} = copy${n}(list); out.push(show(copy)); copy[0] = "changed"; out.push(show(list)); }`,
        `{ const copy = copy${n}(list); out.push(String(1 in copy) + String(Object.is(copy[2], -0)) + copy.length); }`,
        `out.push(show([0, ...list]));`,
        `out.push(show([...list, ...list]));`,
        `out.push(show([...list, 1.5]));`,
        `out.push(show([...list, "text"]));`,
        `out.push(show(Math.max(...list)));`,
        `out.push(show(take(...list)));`,
        `out.push(show(new Array(...list)));`,
        `{ const target${any} = [${r.pick(["", "1", "1.5", '"s"'])}]; out.push(show(target.push(...list))); out.push(show(target)); }`,
        `out.push(show([...list].length));`,
        `{ const [first, ...rest] = list; out.push(show(first) + show(rest)); }`,
        `out.push(show([...copy${n}(list), ...copy${n}(list)].indexOf(2)));`,
        `out.push(show(new Pair(...list)));`,
        `out.push(show(Array.of(...list)));`,
        `out.push(show([...list].sort()));`,
      ];
      for (let k = 2 + r.below(3); k > 0; k--) body.push(r.pick(uses));
    } else if (family === "flatMap") {
      body.push(`const list${any} = ${r.chance(0.5) ? isChanged : "false"} ? ${unusual()} : ${usual()};`);
      const callbacks = [
        `(x${any}) => [x, x * 2]`,
        `(x${any}) => [x, x * 2]`,
        `(x${any}, i${any}) => (i % 2 ? [] : [x])`,
        `(x${any}) => x`,
        `(x${any}) => [[x]]`,
        `(x${any}) => ${cast("[x, , x]")}`,
        `(x${any}, i${any}, all${any}) => { if (i === 1 && all.length < 9 && !Object.isFrozen(all)) all.push(7); return [x]; }`,
        `(x${any}, i${any}, all${any}) => { if (i === 0 && !Object.isFrozen(all)) all.pop(); return [x, i]; }`,
        `(x${any}, i${any}, all${any}) => { if (i === 1 && !Object.isFrozen(all)) all.length = 0; return [x]; }`,
        `(x${any}) => Sub.of(x, x)`,
        `(x${any}) => new Proxy([x, x], {})`,
        `(x${any}) => ({ length: 2, 0: x, 1: x })`,
        `() => "ab"`,
        `() => new Uint8Array(2)`,
        `(x${any}) => { if (x === 3) throw new Error("stopped at 3"); return [x]; }`,
        `(x${any}) => Object.freeze([x, x])`,
        `(x${any}) => getterAt([x, x, x])`,
        `(x${any}) => below(${cast("[x, , x]")})`,
        `(x${any}) => (${isChanged} ? "odd" : [x, x])`,
        `(x${any}) => (${isChanged} ? [x, [x], "s"] : [x, x])`,
        `(x${any}) => (${isChanged} ? [x + 0.5] : [x | 0])`,
        `(x${any}) => grown(x & 3, 1)`,
        `(x${any}) => [{ x }, { x }]`,
      ];
      const uses = [
        `out.push(show(list.flatMap(${r.pick(callbacks)})));`,
        `out.push(show(list.flatMap(${r.pick(callbacks)})));`,
        `out.push(show(list.flatMap(${r.pick(callbacks)}).length));`,
        `out.push(show(list.flatMap(function (${typed ? "this: any, " : ""}x${any}) { return [this.k, x]; }, { k: "self" })));`,
        `out.push(show(Array.prototype.flatMap.call({ length: 3, 0: "a", 2: "c" }, ${r.pick(callbacks)})));`,
        `out.push(show(list.flatMap(${r.pick(callbacks)}).flatMap(${r.pick(callbacks)})));`,
        `{ const made = list.flatMap(${r.pick(callbacks)}); out.push(made.constructor.name + String(Array.isArray(made))); }`,
        `if (${isChanged} && !Object.isFrozen(list)) list.constructor = ${r.pick(["undefined", "Object", "{ [Symbol.species]: Sub }", "{ [Symbol.species]: null }", "{ [Symbol.species]: function (size" + any + ") { return { size }; } }", "Sub"])};`,
        `{ let sum = 0; for (const each of list.flatMap(${r.pick(callbacks)})) sum += typeof each === "number" ? each : 1; out.push(show(sum)); }`,
      ];
      for (let k = 2 + r.below(3); k > 0; k--) body.push(r.pick(uses));
    } else if (family === "booleans") {
      const flags = [`turn % 3 === 0`, `turn > ${change}`, `[1, 2, 5].includes(turn)`, `!!(turn & 2)`, `Boolean(turn % 4)`, `"k" in (turn & 1 ? { k: 1 } : {})`, `Array.isArray(turn & 1 ? [] : 0)`, `!turn`, `turn < 5 && turn > 1`, `Object.is(turn, 3)`]; // prettier-ignore
      const odd = r.pick([`null`, `undefined`, `turn`, `turn + 0.5`, `-0`, `NaN`, `"7"`, `""`, `"x"`, `new Boolean(false)`, `{ valueOf() { return true; } }`, `[]`, `[5]`, `10n`, `Symbol.iterator`, `{ valueOf() { return 10n; } }`]); // prettier-ignore
      const isNarrow = typed && r.chance(0.5);
      body.push(`const flag${isNarrow ? ": boolean" : any} = ${r.pick(flags)};`);
      body.push(`const second${isNarrow ? ": boolean" : any} = ${r.pick(flags)};`);
      body.push(`const mixed${any} = ${isChanged} ? ${odd} : ${r.pick(flags)};`);
      if (r.chance(0.12)) body.push(`const Number = (value${any}) => "my own Number " + String(value);`);
      const f = () => r.pick(["flag", "flag", "second", "mixed", "mixed"]);
      const n1 = (text: string) => (typed ? `(${text} as any)` : text);
      const uses = [
        () => `out.push(show(+${f()}));`,
        () => `out.push(show(Number(${f()})));`,
        () => `out.push(show(-${n1(f())}));`,
        () => `out.push(show(${n1(f())} | 0));`,
        () => `out.push(show(${n1(f())} + ${n1(f())}));`,
        () => `out.push(show(${n1(f())} * ${r.pick(["3", "-1", "0.5", "0", "-0"])}));`,
        () => `out.push(show(${n1(f())} - 1));`,
        () => `total${n} += ${n1(f())}; out.push(show(total${n}));`,
        () => `out.push(show(~~${n1(f())}));`,
        () => `out.push(show(${n1(f())} / ${n1(f())}));`,
        () => `out.push(show(${n1(f())} % 2));`,
        () => `out.push(show(${n1(f())} ** 2));`,
        () => `out.push(show(${n1(f())} << 3));`,
        () => `out.push(show(${n1(f())} >>> 0));`,
        () => `out.push(show(Math.max(${n1(f())}, 0)));`,
        () => `out.push(show([${f()}, ${f()}].map(Number)));`,
        () => `out.push(show(["no", "yes"][+${f()}]));`,
        () => `out.push(show(${cast('["no", "yes"]')}[${n1(f())}]));`,
        () => `out.push(\`\${+${f()}}\`);`,
        () => `{ let moving${any} = ${f()}; moving++; out.push(show(moving)); }`,
        () => `{ let moving${any} = ${f()}; out.push(show(moving--)); out.push(show(moving)); }`,
        () => `out.push(show(${n1(f())} < 1) + show(${n1(f())} == 1) + show(${n1(f())} === 1));`,
        () => `out.push(show(isNaN(${n1(f())})) + show(Number.isInteger(+${f()})));`,
        () => `out.push(show(BigInt(${n1(f())})));`,
        () => `out.push(show(1 / -${n1(f())}));`,
        () => `out.push(show(1 / (${n1(f())} * -1)));`,
        () => `out.push(show(Number(${f()}) + Number(${f()}) + Number(${f()})));`,
        () => `out.push(show(new Float64Array([${n1(f())}])[0]) + show(new Int8Array([${n1(f())}])[0]));`,
        () => `out.push(show((${f()} ? 1 : 0) + +${f()}));`,
        () => `out.push(show(count(${f()}, ${f()}, ${f()})));`,
      ];
      before = `let total${n}${any} = 0;`;
      for (let k = 3 + r.below(5); k > 0; k--) body.push(r.pick(uses)());
    } else {
      const names = r.sample(["alpha", "beta", "gamma", "delta", "then", "length", "0", "constructor"], 2 + r.below(3));
      const name = r.pick(names);
      const birth = r.pick([
        `{}`,
        `{}`,
        `Object.create(above)`,
        `{ __proto__: above }`,
        `Object.create(null)`,
        `Object.create(Object.create(above))`,
      ]);
      const attributes = r.pick([`enumerable: true`, `enumerable: true, configurable: true`, `configurable: true`, ``]);
      body.push(`const above${any} = { ${names[0]}: "above" };`);
      body.push(
        `const all${any} = { ${names.map((each, at) => `${JSON.stringify(each)}: () => ${r.pick([`"got ${each}"`, `turn + ${at}`, `[turn]`])}`).join(", ")} };`,
      );
      body.push(`const target${any} = ${birth};`);
      body.push(`for (const name in all) Object.defineProperty(target, name, { get: all[name], ${attributes} });`);
      const places = [`{}`, `above`, `target`, `parentOf(target)`, `all`, `Object.create(target)`, `[]`];
      const steps = [
        `{ const place${any} = ${isChanged} ? ${r.pick(places)} : ${r.pick(places)}; try { place[${JSON.stringify(name)}] = "stored"; } catch (e${any}) { out.push("store: " + e.constructor.name); } out.push(show(place[${JSON.stringify(name)}])); }`,
        `{ const place${any} = ${isChanged} ? ${r.pick(places)} : ${r.pick(places)}; try { place.${/^\d/.test(name) ? "alpha" : name} = turn; } catch (e${any}) { out.push("store: " + e.constructor.name); } }`,
        `out.push(show(target[${JSON.stringify(name)}]));`,
        `out.push(show(target.${/^\d/.test(names[0]) ? "alpha" : names[0]}));`,
        `out.push(Object.keys(target).join());`,
        `out.push(show({ ...target }));`,
        `if (${isChanged}) { try { out.push(String(delete target[${JSON.stringify(name)}])); } catch (e${any}) { out.push("delete: " + e.constructor.name); } }`,
        `if (${isChanged}) Object.setPrototypeOf(target, ${r.pick(["above", "null", `{ ${name}: "new parent" }`, "all"])});`,
        `if (${isChanged}) above[${JSON.stringify(name)}] = "stored above";`,
        `out.push(String(${JSON.stringify(name)} in target) + String(Object.hasOwn(target, ${JSON.stringify(name)})));`,
        `{ let text = ""; for (const key in target) text += key + "=" + show(target[key]) + ";"; out.push(text); }`,
        `out.push(show(Object.getOwnPropertyDescriptor(target, ${JSON.stringify(name)})?.get === all[${JSON.stringify(name)}]));`,
        `out.push(show(Object.create(target)[${JSON.stringify(name)}]));`,
      ];
      for (let k = 3 + r.below(4); k > 0; k--) body.push(r.pick(steps));
    }

    scenes.push(`${before}
function scene${n}(turn${typed ? ": number" : ""})${typed ? ": string" : ""} {
  const out${typed ? ": string[]" : ""} = [];
  try {
    ${body.join("\n    ")}
  } catch (e${any}) {
    out.push("threw " + (e && e.constructor ? e.constructor.name : typeof e) + (e && e.constructor === Error ? ": " + e.message : ""));
  }
  return out.join(" ");
}
{
  let hash = 0;
  for (let turn = 0; turn < ${turns}; turn++) {
    const line = scene${n}(turn);
    for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
    if (turn < 2 || (turn >= ${change - 1} && turn <= ${change + 1}) || (turn >= ${back - 1} && turn <= ${back}) || turn === ${turns - 1}) console.log("scene ${n} ${family} turn", turn, line.slice(0, 600));
  }
  console.log("scene ${n}", hash);
}`);
  }

  return `function show(value${any}, depth${typed ? ": number" : ""} = 0)${typed ? ": string" : ""} {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 3) return "..";
  if (Array.isArray(value)) {
    const parts${typed ? ": string[]" : ""} = [];
    for (let i = 0; i < value.length && i < 24; i++) parts.push(i in value ? show(value[i], depth + 1) : "hole");
    return "[" + parts.join(",") + "]" + (value.length > 24 ? "+" + value.length : "");
  }
  if (value instanceof Promise) return "a promise";
  if (typeof value.next === "function") return "steps " + show([...value], depth + 1);
  if (ArrayBuffer.isView(value)) return "bytes " + ${cast("value")}.join();
  return "{" + Object.keys(value).slice(0, 8).map(key => key + ":" + show(value[key], depth + 1)).join(",") + "}";
}
class Sub extends Array${typed ? "<any>" : ""} {}
class Walks extends Array${typed ? "<any>" : ""} {
  *[Symbol.iterator]()${any} { yield "walked"; yield this.length; }
}
class Pair {
  ${typed ? "a: any;\n  b: any;\n  " : ""}constructor(a${typed ? "?: any" : ""}, b${typed ? "?: any" : ""}) { this.a = a; this.b = b; }
}
function boxed(first${typed ? ": number" : ""})${numbers} { const list${any} = ["text", 2, 3.5, -0]; list[0] = first; return list; }
function grown(length${typed ? ": number" : ""}, step${typed ? ": number" : ""})${numbers} { const list${numbers} = []; for (let i = 0; i < length; i++) list.push(i * step); return list; }
function shifted(length${typed ? ": number" : ""}, step${typed ? ": number" : ""})${numbers} { const list = grown(length, step); list.shift(); list.unshift(-1, -2); list.shift(); return list; }
function withHole(list${numbers})${numbers} { delete list[1]; return list; }
function longer(list${numbers})${numbers} { list.length += 2; return list; }
function sparse(at${typed ? ": number" : ""})${numbers} { const list${numbers} = [1, 2]; list[at] = 3; return list; }
function below(list${any})${any} { Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: "from the prototype", writable: true, configurable: true } })); return list; }
function ownIterator(list${any})${any} { list[Symbol.iterator] = function* () { yield "mine"; yield list.length; }; return list; }
function getterAt(list${any})${any} { Object.defineProperty(list, 1, { get() { if (list.length < 7) list.push("pushed by the getter"); return "got"; }, enumerable: true, configurable: true }); return list; }
function argumentsOf(..._${typed ? ": any[]" : ""})${any} { return (function () { return arguments; }).apply(null, ${cast("_")}); }
function take(a${typed ? "?: any" : ""}, b${typed ? "?: any" : ""}, ...rest${typed ? ": any[]" : ""})${any} { return [a, b, rest.length, rest[rest.length - 1]]; }
const other = { v: "other" };
function parentOf(value${any})${any} { const parent = Object.getPrototypeOf(value); return parent === null || parent === Object.prototype ? {} : parent; }
function call(f${any}, value${any})${any} { return f(value, "from call"); }
function count(a${any}, b${any}, c${any})${any} { return a + b + c; }
${scenes.join("\n")}
`;
}
