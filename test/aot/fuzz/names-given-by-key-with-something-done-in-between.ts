// Groups of objects of many births are given names by key, and something is done to a name or to the object between two such stores.
//
//   born as        literals, instances of classes and functions, objects below null or another object, lists, an arguments object, what JSON.parse, Object.fromEntries, a spread, structuredClone hand out
//   the keys       texts put together at run time; literal texts out of a list, the same in every turn or another one in each turn, so that one place in the text stores under many names
//   how many       from one name to eleven hundred
//   in between     a name is defined anew with other attributes, deleted, deleted and stored again; the object is frozen, sealed, closed, put below another object; a collection
//   above          String and Number objects, typed arrays, lists, proxies, frozen objects, accessors and read-only members under the names and elements that are stored below
//   by index       stores, Reflect.set with and without another receiver, definitions and deletions at elements inside and outside every range
//   where          in groups that live as long as the program, one step at a time; or in scenes, where an object is born, worked on and looked at within one turn of a loop
//   printed        after each step a digest of all that can be seen: own keys in their order, attributes, each probe asked in five ways, for-in, keys, JSON; and the first object that is unlike its neighbor
import type { Random } from "./random";

export function generate(r: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  // One program has either typed arrays above its objects or elements with accessors on prototypes.
  const world: string = r.pick(["typed-arrays", "indexed-accessors", "indexed-accessors"]);
  const sizes = [1, 2, 3, 3, 4, 5, 8, 9, 10, 17, 33, 64, 65, 70, 130, 200, 600, 1100];
  const many = r.pick([1, 1, 2, 3, 7, 50, 120, 400]);
  const values = [
    "1",
    "-0",
    "1.5",
    '"text"',
    "null",
    "undefined",
    "true",
    "[1]",
    "{ v: 1 }",
    "2147483648",
    "i",
    "String(i)",
    "i + 0.5",
    "10n",
  ];
  const indexes = [
    "0",
    "1",
    "2",
    "3",
    "9",
    "100",
    "70000",
    "4294967294",
    "4294967295",
    '"0"',
    '"1"',
    '"9"',
    '"01"',
    '"-0"',
    '"1.5"',
    "-1",
    "1.5",
    "index(1)",
    "index(9)",
    "text(1)",
    "text(9)",
  ];
  const attributes = [
    "enumerable: false",
    "writable: false",
    "configurable: false",
    "value: 7, writable: false",
    "value: 7",
    "get() { return 5; }",
    "get() { return 5; }, set(v" + any + ') { log.push("set"); }, enumerable: true',
    "enumerable: true, writable: true, configurable: true",
    "value: 8, enumerable: false, configurable: false",
    "writable: true",
    "set(v" + any + ') { log.push("only set"); }',
  ];
  let aboves = [
    'new String("abc")',
    "[1, 2, 3]",
    "new Proxy({}, {})",
    'new Proxy({}, { set(t, k, v, w) { log.push("trap set " + String(k)); return Reflect.set(t, k, v, w); } })',
    'new Proxy({}, { defineProperty(t, k, d) { log.push("trap define " + String(k)); return Reflect.defineProperty(t, k, d); }, has(t, k) { return k in t; } })',
    'Object.freeze({ n1: "frozen above", a: "frozen a" })',
    "{ set n1(v" + any + ') { log.push("set n1 above"); }, get n1() { return "above"; } }',
    "Object.create(null)",
    "null",
    "new Number(5)",
    "function () {}",
    "new Map()",
    typed
      ? "(function (x?: any, y?: any) { Reflect.ownKeys(arguments); return arguments; })(1, 2)"
      : "(function (x, y) { Reflect.ownKeys(arguments); return arguments; })(1, 2)",
    'Object.defineProperty({}, "n1", { value: "read-only above", writable: false })',
    'Object.defineProperty({}, "n2", { value: "hidden above", enumerable: false, writable: true })',
    "P0",
    "new C0(1)",
    "Object.prototype",
    "Array.prototype",
    'Object.assign(Object.create(null), { n1: "plain above", z: 1 })',
  ];
  if (world !== "indexed-accessors")
    aboves.push(
      "new Uint8Array(4)",
      "new Float64Array(2)",
      "new Uint8Array(0)",
      "new BigInt64Array(2)",
      "new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }))",
    );
  if (world !== "typed-arrays")
    aboves.push(
      '{ get 1() { return "got 1"; }, set 1(v' + any + ') { log.push("set 1 above"); } }',
      'Object.defineProperty({}, 1, { value: "read-only 1", writable: false })',
      'Object.freeze({ 1: "frozen 1", 9: "frozen 9" })',
      'Object.freeze(["f0", "f1"])',
    );
  const births = [
    "({})",
    "({ a: 1, b: 2 })",
    '({ a: i, b: "x", c: null, d: 1.5 })',
    "new C0(i)",
    "new C0(i)",
    "new D0(i)",
    typed ? "new (F0 as any)(i)" : "new F0(i)",
    "Object.create(null)",
    "Object.create(P0)",
    "({ __proto__: P0, a: 1 })",
    "[]",
    "[1, 2, 3]",
    "[1.5, , 3]",
    'JSON.parse(\'{"a":1,"n1":2}\')',
    "new L0()",
    "Object.assign(function () {}, { a: 1 })",
    "new Map()",
    typed
      ? "(function (x?: any, y?: any) { Reflect.ownKeys(arguments); return arguments; })(1, 2)"
      : "(function (x, y) { Reflect.ownKeys(arguments); return arguments; })(1, 2)",
    "({ n0: 0, n1: 1, n2: 2 })",
    "({ [key(0)]: 0, [key(1)]: 1 })",
    '({ 0: "zero", a: 1 })',
    'Object.fromEntries([[key(0), 0], [key(1), 1], ["a", 2]])',
    "({ ...{ a: 1, n1: 2 } })",
    "structuredClone({ a: 1, n1: 2 })",
  ];
  const groups = 1 + r.below(3);
  const lines: string[] = [];
  const born: string[] = [];
  const tops: number[] = [];
  for (let g = 0; g < groups; g++) {
    const birth = r.pick(births);
    born.push(birth);
    tops.push(0);
    lines.push(
      `function make${g}(i${typed ? ": number" : ""})${any} { return ${birth}; }`,
      `const g${g}${typed ? ": any[]" : ""} = []; for (let i = 0; i < ${g === 0 ? many : r.pick([1, 2, 5])}; i++) g${g}.push(make${g}(i));`,
    );
  }
  let fresh = 0;
  // One step on the object `o` (number `i` of its group or scene); `top` counts the names key(0) .. that it has been given. A step that is not about one object comes back as { whole }.
  const step = (top: { n: number }): { body?: string; whole?: string } => {
    const pool = () =>
      r.pick([
        `names[(i + ${r.below(4)}) & 3]`,
        `names[(i + ${r.below(4)}) & 3]`,
        `names[(i + ${r.below(4)}) & 3]`,
        `names[${r.below(16)}]`,
        `names[(i + ${r.below(16)}) & 15]`,
        `names[(i * 7 + ${r.below(16)}) & 15]`,
      ]);
    const had = () => (r.chance(0.5) ? `key(${r.below(Math.max(1, Math.min(top.n, 140)))})` : pool());
    const name = () =>
      r.chance(0.75)
        ? had()
        : r.pick([
            '"a"',
            '"b"',
            '"n1"',
            '"n2"',
            "sym0",
            '"constructor"',
            '"length"',
            '"toString"',
            "text(1)",
            '"z"',
            `key(${top.n})`,
          ]);
    const safe = (n: string) => (!typed || !/^"[ab]"$/.test(n) ? n : had());
    const kind = r.below(34);
    if (kind < 5) {
      const size = r.pick(sizes),
        from = top.n;
      top.n += size;
      return {
        body: `for (let j = ${from}; j < ${from + size}; j++) o[key(j)] = ${r.pick(["j", "j", "j + 0.5", "String(j)", "i + j", "null"])};`,
      };
    }
    if (kind < 10) return { body: `Object.defineProperty(o, ${safe(name())}, { ${r.pick(attributes)} });` };
    if (kind < 14)
      return { body: r.chance(0.4) ? `o[key(${top.n++})] = "more";` : `o[${pool()}] = ${r.pick(values)};` };
    if (kind < 19) return { whole: "collect();" };
    if (kind < 21) return { body: `note(delete o[${safe(name())}]);` };
    if (kind === 21) return { body: `Object.${r.pick(["freeze", "seal", "preventExtensions"])}(o);` };
    if (kind < 24) return { body: `Object.setPrototypeOf(o, ${r.pick(aboves)});` };
    if (kind < 27)
      return {
        body: r.pick([
          `o[${r.pick(indexes)}] = ${r.pick(values)};`,
          `note(Reflect.set(o, ${r.pick(indexes)}, ${r.pick(values)}));`,
          `note(Reflect.set(o, ${r.pick(indexes)}, ${r.pick(values)}, g${r.below(groups)}[0]));`,
          `note(Reflect.defineProperty(o, ${r.pick(indexes)}, { ${r.pick(attributes)} }));`,
          `note(delete o[${r.pick(indexes)}]);`,
        ]),
      };
    if (kind === 27)
      return { body: `let sum${any} = 0; for (let t = 0; t < 300; t++) sum = read${r.below(6)}(o); note(sum);` };
    if (kind === 28)
      return {
        body: r.pick([
          `Object.assign(o, { n1: "assigned", z: 1 });`,
          `note(state(Object.assign({}, o)));`,
          `note(state({ ...o }));`,
          `Object.assign(o, g${r.below(groups)}[0]);`,
          `o[sym0] = i;`,
          `note(Object.entries(o).length);`,
          `note(state(Object.getOwnPropertyDescriptors(o)).length);`,
        ]),
      };
    if (kind === 29) return { body: `const k = ${safe(name())}; const v = o[k]; delete o[k]; o[k] = v;` };
    if (kind === 30) return { body: `o[${r.pick(['"__proto__"', "proto()"])}] = ${r.pick(aboves)};` };
    if (kind === 31 && world !== "typed-arrays")
      return {
        whole: `try { Object.defineProperty(${r.pick(["C0.prototype", "P0", "F0.prototype", "W0.prototype"])}, ${r.pick(["1", "3", "9"])}, { ${r.pick(["set(v" + any + ') { log.push("indexed set"); }', 'get() { return "indexed get"; }', 'value: "indexed read-only", writable: false', 'get() { return "indexed"; }, set(v' + any + ') { log.push("indexed set"); }, configurable: true'])} }); } catch (e) { note(e); }`,
      };
    if (kind === 32)
      return {
        whole: `try { Object.setPrototypeOf(${r.pick(["C0.prototype", "P0", "F0.prototype"])}, ${r.pick(aboves)}); } catch (e) { note(e); }`,
      };
    return {
      body: r.pick([
        `o.a = ${typed ? "i + 1" : r.pick(values)};`,
        `o.n1 = ${r.pick(values)};`,
        `o.fresh${fresh++} = ${r.pick(values)};`,
        `o.n${top.n + 1} = "by name";`,
        `if (Array.isArray(o)) o.length = ${r.pick(["0", "2", "5"])};`,
        `if (Array.isArray(o)) o.push(i);`,
      ]),
    };
  };
  const script: string[] = [];
  const acts = 3 + r.below(5);
  for (let act = 0; act < acts; act++) {
    if (r.chance(0.45)) {
      // A scene: the object is born, worked on and looked at within one turn of a loop.
      const top = { n: 0 },
        inside: string[] = [];
      if (r.chance(0.6)) {
        // A name is added by key, something is done to it or to the object, another name is added by key: the keys are literal texts out of a list and most of them another one in each turn.
        const turning = () =>
          r.pick([
            `names[(i + ${r.below(4)}) & 3]`,
            `names[(i + ${r.below(4)}) & 3]`,
            `names[(i + ${r.below(16)}) & 15]`,
            `names[${r.below(16)}]`,
            `key(${1000 + r.below(4)} + (i & 3))`,
          ]);
        const size = r.pick(sizes);
        top.n = size;
        inside.push(
          `try { for (let j = 0; j < ${size}; j++) o[${r.pick(["key(j)", "key(j)", '"big" + j', "String(j + 0.5)"])}] = ${r.pick(["j", "j + 0.5", "String(j)", "null"])}; } catch (e) { note(e); }`,
        );
        for (let k = 1 + r.below(3); k > 0; k--) {
          const x = turning(),
            y = turning();
          inside.push(`try { o[${x}] = ${r.pick(values)}; } catch (e) { note(e); }`);
          inside.push(
            `try { ${r.pick([`Object.defineProperty(o, ${x}, { ${r.pick(attributes)} });`, `Object.defineProperty(o, ${x}, { ${r.pick(attributes)} });`, `Object.defineProperty(o, ${x}, { ${r.pick(attributes)} });`, `delete o[${x}];`, `delete o[${x}]; o[${x}] = 1;`, `Object.defineProperty(o, ${y}, { ${r.pick(attributes)} });`, `Object.setPrototypeOf(o, ${r.pick(aboves)});`, `Object.${r.pick(["freeze", "seal", "preventExtensions"])}(o);`, `Object.defineProperty(o, ${x}, { ${r.pick(attributes)} }); Object.defineProperty(o, ${x}, { ${r.pick(attributes)} });`, `Object.assign(o, { [${x}]: 2 });`, `o[sym0] = 1;`, `Object.defineProperty(o, key(0), { ${r.pick(attributes)} });`])} } catch (e) { note(e); }`,
          );
          if (r.chance(0.2)) inside.push("collect();");
          inside.push(`try { o[${y}] = ${r.pick(values)}; } catch (e) { note(e); }`);
          if (r.chance(0.3)) inside.push("collect();");
        }
      } else
        for (let s = 3 + r.below(6); s > 0; s--) {
          const { body, whole } = step(top);
          inside.push(body ? `try { ${body} } catch (e) { note(e); }` : whole!);
        }
      if (r.chance(0.7)) inside.push("collect();");
      const probesHere = [
        "key(0)",
        "key(1)",
        `key(${Math.max(0, top.n - 1)})`,
        `key(${Math.max(0, top.n - 2)})`,
        `key(${top.n})`,
        '"a"',
        '"n1"',
        "1",
        "9",
        "key(1000)",
        "key(1001)",
        "key(1002)",
        "key(1003)",
        '"big0"',
        '"big1"',
        '"0.5"',
      ];
      script.push(
        `function scene${act}()${typed ? ": void" : ""} {\n  for (let i = 0; i < ${r.pick([1, 3, 40, 40, 150, 400])}; i++) {\n    const o${any} = ${r.pick(births)};\n    ${inside.join("\n    ")}\n    let t = state(o) + " ? "; for (const k of [${probesHere.join(", ")}, ...names]) t += asked(o, k) + " "; log.push(hash(t + walked(o)));\n  }\n}\nscene${act}();`,
        `show(${act});`,
      );
    } else {
      // A run of steps that stays with one group.
      const g = r.below(groups),
        top = { n: tops[g] };
      for (let s = 2 + r.below(6); s > 0; s--) {
        const { body, whole } = step(top);
        script.push(
          body
            ? `for (let i = 0; i < g${g}.length; i++) { const o = g${g}[i]; try { ${body} } catch (e) { note(e); } }`
            : whole!,
        );
        if (r.chance(0.5)) script.push(`show(${act});`);
      }
      tops[g] = top.n;
      script.push(`show(${act});`);
    }
  }
  const top = Math.max(...tops);
  const probes = [
    "key(0)",
    "key(1)",
    "key(2)",
    `key(${Math.max(0, top - 1)})`,
    `key(${top})`,
    `key(${top >> 1})`,
    '"a"',
    '"n1"',
    '"z"',
    "sym0",
    "0",
    "1",
    "3",
    "9",
    '"9"',
    "4294967295",
    '"length"',
  ];
  const p = (names: string) =>
    names
      .split(",")
      .map(each => each + any)
      .join(", ");
  return `// ${world}, born as: ${born.join(" | ")}
const log${typed ? ": string[]" : ""} = [];
const parts${typed ? ": string[]" : ""} = JSON.parse('["n", "__pro", "to__"]');
const numbers${typed ? ": number[]" : ""} = JSON.parse("[0,1,2,3,4,5,6,7,8,9]");
const sym0 = Symbol("sym0");
const names${typed ? ": string[]" : ""} = ["p", "q", "r", "s", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15"];
function key(i${typed ? ": number" : ""})${typed ? ": string" : ""} { return parts[0] + i; }
function proto()${typed ? ": string" : ""} { return parts[1] + parts[2]; }
function index(i${typed ? ": number" : ""})${typed ? ": number" : ""} { return numbers[i]; }
function text(i${typed ? ": number" : ""})${typed ? ": string" : ""} { return String(numbers[i]); }
function collect()${typed ? ": void" : ""} { (globalThis${typed ? " as any" : ""}).Bun.gc(true); }
const P0${any} = { inherited: 1, get viaGetter() { return "getter of P0"; } };
class W0 {}
new W0();
class C0 { a${typed ? ": number" : ""}; b${typed ? ": string" : ""} = "x";${typed ? " [k: string]: any; [k: symbol]: any;" : ""} constructor(i${typed ? ": number" : ""}) { this.a = i; } }
class D0 extends C0 { c${typed ? ": number | null" : ""} = null; d${typed ? ": number" : ""} = 1.5; }
class L0 extends Array${typed ? "<any>" : ""} {}
function F0(${typed ? "this: any, i: number" : "i"}) { this.a = i; this.f = "f"; }
function hash(t${typed ? ": string" : ""})${typed ? ": string" : ""} { let h = 0; for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function value(${p("v")})${typed ? ": string" : ""} { return typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v !== null ? "object" : Object.is(v, -0) ? "-0" : typeof v + ":" + String(v); }
function note(${p("v")})${typed ? ": void" : ""} { log.push(v instanceof Error ? "THROWS " + v.constructor.name : typeof v === "string" && v.length > 60 ? v.length + ":" + hash(v) : value(v)); }
function state(${p("o")})${typed ? ": string" : ""} {
  let t = "";
  try { for (const k of Reflect.ownKeys(o)) { const d${any} = Reflect.getOwnPropertyDescriptor(o, k); t += String(k) + "=" + ("value" in d ? value(d.value) + (d.writable ? "w" : "-") : (d.get ? "g" : "-") + (d.set ? "s" : "-")) + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + ";"; } } catch (e) { t += "THROWS " + (e${typed ? " as Error" : ""}).constructor.name; }
  return t + (Object.isExtensible(o) ? "" : Object.isFrozen(o) ? " frozen" : Object.isSealed(o) ? " sealed" : " closed");
}
function asked(${p("o,k")})${typed ? ": string" : ""} {
  let t = "";
  try { t += value(o[k]); } catch (e) { t += "T"; }
  try { t += "," + (k in o); } catch (e) { t += ",T"; }
  try { t += "," + Object.hasOwn(o, k); } catch (e) { t += ",T"; }
  try { t += "," + Object.prototype.propertyIsEnumerable.call(o, k); } catch (e) { t += ",T"; }
  try { t += "," + value(Reflect.get(o, k)); } catch (e) { t += ",T"; }
  return t;
}
function walked(${p("o")})${typed ? ": string" : ""} { let t = ""; try { const seen = new Set${typed ? "<string>" : ""}(); for (const k in o) { if (!seen.has(k)) t += k + ","; seen.add(k); } t += "|" + Object.keys(o).join(); t += "|" + (Array.isArray(o) && o.length > 100000 ? "long" : JSON.stringify(o, (k, v) => (typeof v === "bigint" ? "big" : v))); } catch (e) { t += "THROWS " + (e${typed ? " as Error" : ""}).constructor.name; } return t; }
function read0(o${typed ? ": C0" : ""})${any} { return o.a; }
function read1(${p("o")})${any} { return o.n1; }
function read2(${p("o")})${any} { return o[key(1)]; }
function read3(${p("o")})${any} { return o[1]; }
function read4(${p("o")})${any} { return "n1" in o; }
function read5(${p("o")})${any} { return o.inherited; }
${lines.join("\n")}
const all${typed ? ": any[][]" : ""} = [${Array.from({ length: groups }, (_, g) => "g" + g).join(", ")}];
function show(step${typed ? ": number" : ""})${typed ? ": void" : ""} {
  for (let g = 0; g < all.length; g++) {
    let whole = "", odd = -1, before = "";
    for (let i = 0; i < all[g].length; i++) {
      const o = all[g][i];
      let t = state(o) + " ? ";
      for (const k of [${probes.join(", ")}, ...names]) t += asked(o, k) + " ";
      t += walked(o);
      const alike = t.replace(/\\d+(\\.5)?/g, "#");
      if (i > 0 && alike !== before && odd < 0) odd = i;
      before = alike; whole += t;
    }
    console.log("step " + step + " g" + g + " " + whole.length + ":" + hash(whole) + (odd < 0 ? "" : " the first unlike its neighbor: " + odd) + " log " + log.length + ":" + hash(log.join()));
    if (all[g].length) console.log("  " + state(all[g][0]).slice(0, 300));
  }
}
show(-1);
${script.join("\n")}
console.log(log.slice(-40).join(" "));
`;
}
