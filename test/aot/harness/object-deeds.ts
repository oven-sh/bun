// One object whose making the build sees, three deeds one after the other out of twenty, every ordered triple, and what a program
// can see of the object afterwards. `reads`: members read in the cell's own function, nothing is handed the object.
// `whole`: own keys in their order, descriptors, JSON, and whether it is frozen, by built-ins that take the object.
import type { Cell } from "./cells";

export const makers = {
  literal: () => ["", `{ a: 1, b: 2 }`],
  instance: (id: string) => [`class C${id} { a = 1; b = 2; }\n`, `new C${id}()`],
  inherits: (id: string) => [
    `const above${id} = { a: 0, d: 9 };\n`,
    `Object.assign(Object.create(above${id}), { a: 1, b: 2 })`,
  ],
  bare: () => ["", `{ __proto__: null, a: 1, b: 2 }`],
  list: () => ["", `Object.assign([7, 8], { a: 1, b: 2 })`],
  function: () => ["", `Object.assign(function () {}, { a: 1, b: 2 })`],
};

const deeds: Record<string, string> = {
  "a=3": `o.a = 3;`,
  "c=4": `o.c = 4;`,
  "del a": `delete o.a;`,
  "del b": `delete o.b;`,
  "get a": `Object.defineProperty(o, "a", { get() { return 5; }, configurable: true, enumerable: true });`,
  "a fixed": `Object.defineProperty(o, "a", { value: 6, writable: false });`,
  "c hidden": `Object.defineProperty(o, "c", { value: 7, enumerable: false, configurable: true, writable: true });`,
  freeze: `Object.freeze(o);`,
  seal: `Object.seal(o);`,
  closed: `Object.preventExtensions(o);`,
  above: `Object.setPrototypeOf(o, { a: 8, c: 8, d: 8 });`,
  "[0]": `o[0] = 10;`,
  symbol: `o[Symbol.for("s")] = 11;`,
  assign: `Object.assign(o, { b: 12, e: 13 });`,
  "a++": `o.a++;`,
  "b text": `o.b += "x";`,
  swap: `[o.a, o.b] = [o.b, o.a];`,
  each: `for (const k in o) o[k] = k;`,
  "a void": `o.a = undefined;`,
  "a half": `o.a = 1.5;`,
};

const textOf = (value: string) => `(Object.is(${value}, -0) ? "-0" : String(${value}))`;
const looks: Record<string, string> = {
  reads: `log(${["a", "b", "c", "d", "e"].map(k => `"${k}:" + typeof o.${k} + " " + ${textOf("o." + k)} + " " + ("${k}" in o)`).join(` + " " + `)} + " 0:" + ${textOf("o[0]")});`,
  whole: `log(Reflect.ownKeys(o).map(String).join()); log(Object.entries(Object.getOwnPropertyDescriptors(o)).map(([k, d]) => k + (d.get ? "G" : "") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + ("value" in d ? "=" + String(d.value) : "")).join()); log(JSON.stringify(o)); log("" + Object.isFrozen(o) + Object.isSealed(o) + Object.isExtensible(o)); { let seen = ""; for (const k in o) seen += k; log(seen); }`,
};

export const call = `try { run(); } catch (e) { log("threw " + e.name); }`;

export function cells(maker: keyof typeof makers): Cell[] {
  const all: Cell[] = [];
  const names = Object.keys(deeds);
  for (const x of names)
    for (const y of names)
      for (const z of names)
        for (const look of Object.keys(looks)) {
          const id = maker + (all.length + 1);
          const [head, make] = makers[maker](id);
          const done = [x, y, z].map(deed => `try { ${deeds[deed]} } catch (e) { log("!" + e.name); }`).join(" ");
          all.push({
            id,
            what: `${maker} | ${x} . ${y} . ${z} | ${look}`,
            text: `${head}function ${id}() { const o = ${make}; ${done} ${looks[look]} }`,
          });
        }
  return all;
}
