// Objects of one literal get a value of another kind than the literal shows into one field, by a store or by the definition of a class field, one after the other and each in another state.
//
//   the literal   one to five fields, with and without a method; the field holds a whole number, a fraction, a boolean or a text
//   the state     as made, without the field, not extensible, sealed, frozen, with one property more, without another field, the field deleted and stored again, read-only, not configurable, hidden
//   the value     comes by `new Stamp(o)`, whose base returns `o`, by a store in a function, or by a store on the spot
//   looked at     nothing but whether it threw, `delete`, `in`, the keys, `Object.hasOwn`, `typeof`
import type { Random } from "./random";

const others: Record<string, string[]> = {
  "2": ['"field"', "1.5", "null", "undefined", "{ x: 1 }", "4294967296", "true"],
  "1.5": ['"field"', "null", "{ x: 1 }", "true"],
  "true": ['"field"', "1", "null"],
  '"s"': ["1", "null", "{ x: 1 }"],
};

export function generate(random: Random): { file: string; text: string } {
  const isStrict = random.chance(0.6);
  const names = random.pick([["a", "k", "z"], ["k"], ["a", "k"], ["k", "z"], ["a", "b", "k", "y", "z"]]);
  const shown = random.pick(["2", "2", "2", "1.5", "true", '"s"']);
  const spelled = [
    ...(random.chance(0.5) ? ["m() { return 1; }"] : []),
    ...names.map(name => `${name}: ${name === "k" ? shown : "1"}`),
  ].join(", ");
  const [defined, stored] = [random.pick(others[shown]), random.pick(others[shown])];
  const states = [
    "",
    "",
    "",
    "delete o.k;",
    "delete o.k;",
    "Object.preventExtensions(o);",
    "Object.preventExtensions(o); delete o.k;",
    "delete o.k; Object.preventExtensions(o);",
    "Object.seal(o);",
    "Object.freeze(o);",
    "delete o.k; Object.seal(o);",
    "o.more = 1;",
    "o.more = 1; delete o.k;",
    "delete o.k; o.more = 1;",
    `delete o.${names[0]};`,
    `delete o.k; o.k = ${shown};`,
    'Object.defineProperty(o, "k", { writable: false });',
    'Object.defineProperty(o, "k", { configurable: false });',
    'Object.defineProperty(o, "k", { enumerable: false });',
  ];
  // In every second program the objects differ only in whether they still have the field.
  const integrity = random.pick([
    "",
    "Object.preventExtensions(o);",
    "Object.preventExtensions(o);",
    "Object.seal(o);",
  ]);
  const statesOfProgram = random.chance(0.5)
    ? states
    : [integrity, integrity, `${integrity} delete o.k;`, `delete o.k; ${integrity}`];
  const seen = random.pick([
    '""',
    '""',
    "delete o.k",
    '"k" in o',
    "Object.keys(o).join()",
    'Object.hasOwn(o, "k")',
    "typeof o.k",
  ]);
  const body = [
    `function create() { return { ${spelled} }; }`,
    `class Stamp extends function (given) { return given; } { k = ${defined}; }`,
    `function store(o) { o.k = ${stored}; }`,
    'let trail = "";',
  ];
  const isInFunctions = random.chance(0.5);
  for (let index = 0, count = random.between(2, 6); index < count; index++) {
    const action = random.pick(["new Stamp(o);", "new Stamp(o);", "store(o);", `o.k = ${stored};`]);
    const text = `const o = create(); try { ${random.pick(statesOfProgram)} } catch (e) { trail += e.name + " "; } let said = "done"; try { ${action} } catch (e) { said = e.name; } let seen; try { seen = ${seen}; } catch (e) { seen = e.name; } trail += ${index} + " " + said + " " + seen + "; ";`;
    body.push(isInFunctions ? `function step${index}() { ${text} }\nstep${index}();` : `{ ${text} }`);
  }
  body.push("console.log(trail);");
  const directive = isStrict ? ['"use strict";'] : [];
  const lines = random.chance(0.5) ? ["(() => {", ...directive, ...body, "})();"] : [...directive, ...body];
  return { file: "main.js", text: lines.join("\n") + "\n" };
}
