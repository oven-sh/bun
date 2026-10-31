// One program of built-ins-on-written-structure, lists-whose-iteration-is-replaced.js: `bun test/aot/generate.ts built-ins-on-written-structure <where>` writes it.
// Whatever iterates a list asks the list for its iterator. Each way to iterate meets each way to give a written list another iterator, in place:
// once on a list of the function that iterates it, once on a list that a variable of the module holds.
import type { WrittenProgram } from "../generate";

// L stands for the list.
const consumers: readonly string[] = [
  "[...L].join()", '["<", ...L, ">"].join()', "[...L, ...L].length", "[...new Set(L)].join()", "new Set(L).size", 'new Set(["z", ...L]).size', "new Set(L).has(first)",
  "Array.from(L).join()", 'Array.from(L, value => value + "!").join()', "Array.from(new Set(L)).join()",
  '(() => { let all = ""; for (const value of L) all += value; return all; })()',
  "(() => { const [one, two, ...rest] = L; return `${one} ${two} ${rest.length}`; })()", "(() => { const [one] = L; return one; })()", "(([one, two]) => `${one} ${two}`)(L)",
  "count(...L)", "new Counted(...L).count", "String.prototype.concat.call(...L)", "[...(function* () { yield* L; })()].join()",
  "(await Promise.all(L)).join()", "(await Promise.allSettled(L)).length", "await Promise.race(L)", "await Promise.any(L)",
  "Object.keys(Object.groupBy(L, value => value)).join()", "Map.groupBy(L, value => value).size", "Iterator.from(L).toArray().join()",
  "JSON.stringify(Object.fromEntries(L.map ? [...L].map(value => [value, 1]) : []))", "new Map([...L].map(value => [value, 1])).size",
  // These go by the elements and the length, whatever the iterator is.
  "L.join()", "L.includes(first)", "L.indexOf(first)", "L.length", "[].concat(L).join()", "L.map(value => value).join()", "L[0]", "JSON.stringify(L)",
];

const other = 'function* () { seen.push("asked"); yield "other"; }';
// L stands for the list. What stands here runs between the literal and the consumer.
const ways: Readonly<Record<string, string>> = {
  "nothing": "",
  "a store": `L[Symbol.iterator] = ${other};`,
  "a store by a key that is computed": `L[keyOfIteration()] = ${other};`,
  "defineProperty": `Object.defineProperty(L, Symbol.iterator, { value: ${other} });`,
  "defineProperties": `Object.defineProperties(L, { [Symbol.iterator]: { value: ${other} } });`,
  "a getter": `Object.defineProperty(L, Symbol.iterator, { get() { seen.push("read"); return ${other}; } });`,
  "Reflect.defineProperty": `Reflect.defineProperty(L, Symbol.iterator, { value: ${other} });`,
  "Reflect.set": `Reflect.set(L, Symbol.iterator, ${other});`,
  "Object.assign": `Object.assign(L, { [Symbol.iterator]: ${other} });`,
  "undefined as the iterator": "L[Symbol.iterator] = undefined;",
  "a number as the iterator": "L[Symbol.iterator] = 5;",
  "an iterator that throws": 'L[Symbol.iterator] = () => { throw new RangeError("no"); };',
  "setPrototypeOf": `Object.setPrototypeOf(L, { __proto__: Array.prototype, [Symbol.iterator]: ${other} });`,
  "Reflect.setPrototypeOf": `Reflect.setPrototypeOf(L, { __proto__: Array.prototype, [Symbol.iterator]: ${other} });`,
  "a store to __proto__": `L.__proto__ = { __proto__: Array.prototype, [Symbol.iterator]: ${other} };`,
  "no prototype": "Object.setPrototypeOf(L, null);",
  "the prototype of objects": "Object.setPrototypeOf(L, Object.prototype);",
  "a function that is handed the list": "replaceIn(L);",
  "a function that is handed the list in an object": "replaceInside({ held: L });",
  "another name for the list": `{ const alias = L; alias[Symbol.iterator] = ${other}; }`,
  "a callback": `[0].forEach(() => { L[Symbol.iterator] = ${other}; });`,
  "only sometimes": `if (always()) L[Symbol.iterator] = ${other};`,
  "never, though it stands there": `if (!always()) L[Symbol.iterator] = ${other};`,
};

const lines = [
  "// Whatever iterates a written list asks it for its iterator: each way to iterate against each way to give the list another one. Written by ../generate-replaced-iteration.ts.",
  "const seen = [];",
  'const out = (label, answer) => console.log(label, String(answer), "|", seen.splice(0).join());',
  "const count = (...all) => all.length;",
  "class Counted { constructor(...all) { this.count = all.length; } }",
  'const first = String.fromCharCode(97);',
  "const keyOfIteration = () => [Symbol.iterator][0];",
  "const always = () => Date.now() > 0;",
  `function replaceIn(list) { list[Symbol.iterator] = ${other}; }`,
  `function replaceInside(holder) { holder.held[Symbol.iterator] = ${other}; }`,
];
let number = 0;
for (const consumer of consumers) {
  for (const [name, way] of Object.entries(ways)) {
    const label = JSON.stringify(`${consumer} | ${name}`);
    lines.push(`await (async () => { const list = ["a", "b", "c"]; ${way.replaceAll("L", "list")} try { out(${label}, ${consumer.replaceAll("L", "list")}); } catch (error) { out(${label}, error.constructor.name); } })();`);
    const variable = `held${number++}`;
    lines.push(`const ${variable} = ["a", "b", "c"]; ${way.replaceAll("L", variable)}`);
    lines.push(`await (async () => { try { out("  in a variable", ${consumer.replaceAll("L", variable)}); } catch (error) { out("  in a variable", error.constructor.name); } })();`);
    if (!way) continue;
    const late = `late${number++}`;
    lines.push(`const ${late} = ["a", "b", "c"]; const read${late} = async () => { try { out("  asked before and behind", ${consumer.replaceAll("L", late)}); } catch (error) { out("  asked before and behind", error.constructor.name); } };`);
    lines.push(`await read${late}(); ${way.replaceAll("L", late)} await read${late}();`);
  }
}

export const programs = (): WrittenProgram[] => [{ entry: "lists-whose-iteration-is-replaced.js", files: { "lists-whose-iteration-is-replaced.js": lines.join("\n") + "\n" } }];
