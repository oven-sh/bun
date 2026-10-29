// `sort` and `toSorted` of arrays and typed arrays, with comparators that do not behave.
//
//   elements     integers, doubles, both, doubles among NaN, -0 and infinities, strings, objects, objects that lack the compared field,
//                numbers among undefined and null
//   made by      push, a literal, new Array(n), Array.from, a subclass; with holes or without
//   then         nothing, shift, unshift, a splice at the front, a delete, a longer length, a far index, a named property, frozen, sealed,
//                closed to new properties, a read-only length
//   order        random with few or many equal elements, ascending, descending, all equal, one long run and a short one, many short runs,
//                two runs that interleave, two runs of which the second lies below the first
//   length       0 to 5,000, most often around 2, 8, 32, 64 and 128
//   answers      honest, reversed, random, NaN, undefined, always 1, -1 or 0, booleans, strings, infinities, an object with valueOf, a BigInt,
//                a symbol, a promise; honest but for every n-th call
//   at one call  the comparator throws; cuts, empties or grows the array; stores another kind of element; deletes one; freezes or seals the
//                array; makes an element an accessor or the length read-only; sorts, reverses, fills or shifts the same array; gives it another
//                prototype; collects garbage. A typed array has its buffer resized or transferred
//   printed      per scene: what came back or what was thrown, the number of calls, and of the array: Array.isArray, the length, a hash of
//                the elements in order, a hash that no order changes, the number of holes
import type { Random } from "./random";

interface Kind {
  type: string;
  make: (rank: string, index: string) => string;
  /** A literal with the same kind of element, or undefined where a literal says nothing new. */
  literal?: (rank: number) => string;
  honest: string;
  /** An element of another kind of storage. */
  stranger: string;
}

const byOrder = "(a < b ? -1 : a > b ? 1 : 0)";

const kinds: Kind[] = [
  { type: "number", make: rank => `(${rank}) | 0`, literal: rank => String(rank), honest: "a - b", stranger: "0.5" },
  { type: "number", make: rank => `(${rank}) + 0.5`, literal: rank => rank + ".5", honest: "a - b", stranger: `"text"` },
  { type: "number", make: rank => `((${rank}) & 1 ? (${rank}) | 0 : (${rank}) + 0.25)`, honest: "a - b", stranger: "{}" },
  {
    type: "number",
    make: rank => `special(${rank})`,
    literal: rank => (rank % 5 === 0 ? "NaN" : rank % 7 === 0 ? "-0" : rank + ".5"),
    honest: "a - b",
    stranger: "undefined",
  },
  { type: "string", make: rank => `"s" + (${rank})`, literal: rank => `"s${rank}"`, honest: byOrder, stranger: "1.5" },
  { type: "{ x: number; id: number }", make: (rank, index) => `({ x: (${rank}) | 0, id: ${index} })`, honest: "a.x - b.x", stranger: "7" }, // prettier-ignore
  { type: "{ x?: number; id: number }", make: (rank, index) => `((${rank}) % 7 === 0 ? { id: ${index} } : { x: (${rank}) | 0, id: ${index} })`, honest: "open(a).x - open(b).x", stranger: "null" }, // prettier-ignore
  { type: "number | undefined | null", make: rank => `((${rank}) % 5 === 0 ? undefined : (${rank}) % 7 === 0 ? null : (${rank}) + 0.5)`, honest: "open(a) - open(b)", stranger: `"text"` }, // prettier-ignore
];

const lengths = [0, 1, 2, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 40, 63, 64, 65, 100, 127, 128, 129, 130, 140, 200, 257, 600, 1000, 5000];

function drawOrder(r: Random, length: number): string {
  const half = length >> 1;
  return r.pick([
    `random() % ${r.pick([2, 3, 10, 1000, 100000])}`,
    `random() % ${Math.max(1, length)}`,
    `i`,
    `${length} - i`,
    `7`,
    `(i < ${Math.max(0, length - 3)} ? i : ${length} - i)`,
    `(i < 3 ? ${length} - i : i)`,
    `i % ${r.pick([2, 3, 5, 9, 33])}`,
    `(i * 7919) % ${Math.max(1, length)}`,
    `(i < ${half} ? i * 2 : (i - ${half}) * 2 + 1)`,
    `(i < ${half} ? i + ${length} : i)`,
    `(i < ${half} ? i : ${length} - i)`,
    `(i % 40 < 32 ? i : ${length} - i)`,
  ]);
}

/** What the comparator answers. The second member says whether it is a number as TypeScript sees it. */
function drawAnswer(r: Random, honest: string): [string, boolean] {
  return r.weighted<[string, boolean]>([
    [6, [honest, true]],
    [2, [`-(${honest})`, true]],
    [3, [`(random() % 3) - 1`, true]],
    [1, [`(random() % 2001) - 1000 + 0.5`, true]],
    [2, [`NaN`, true]],
    [1, [`undefined`, false]],
    [2, [`1`, true]],
    [2, [`-1`, true]],
    [1, [`0`, true]],
    [1, [`-0`, true]],
    [1, [`(${honest}) > 0`, false]],
    [1, [`(${honest}) < 0`, false]],
    [1, [`String(${honest})`, false]],
    [1, [`"text"`, false]],
    [1, [`((${honest}) < 0 ? -Infinity : Infinity)`, true]],
    [1, [`(${honest}) * 1e-320`, true]],
    [1, [`{ valueOf: () => ${honest} }`, false]],
    [1, [`{ valueOf() { calls += 1000; return ${honest}; } }`, false]],
    [1, [`(calls > ${r.between(1, 30)} ? 1n : ${honest})`, false]],
    [1, [`(calls > ${r.between(1, 30)} ? Symbol("answer") : ${honest})`, false]],
    [1, [`Promise.resolve(${honest})`, false]],
    [1, [`null`, false]],
    [2, [`(calls % ${r.between(2, 9)} === 0 ? NaN : ${honest})`, true]],
    [2, [`(calls % ${r.between(2, 9)} === 0 ? -(${honest}) : ${honest})`, true]],
    [1, [`(calls % ${r.between(2, 9)} === 0 ? 0 : ${honest})`, true]],
  ]);
}

function drawArrayAction(r: Random, kind: Kind, length: number): string {
  const element = kind.make(String(r.below(1000)), "-1");
  const at = String(r.below(Math.max(1, length)));
  return r.pick([
    `throw new RangeError("call " + calls);`,
    `throw "thrown text";`,
    `list.length = 0;`,
    `list.length = ${r.below(Math.max(1, length))};`,
    `list.length = ${length + r.between(1, 300)};`,
    `list.push(${element});`,
    `for (let k = 0; k < ${r.pick([3, 100, 2000])}; k++) list.push(${element});`,
    `list.pop();`,
    `list.shift();`,
    `list.unshift(${element});`,
    `list.splice(0, ${r.between(1, 5)});`,
    `list.splice(0, 0, ${element}, ${element});`,
    `list.splice(${at}, 1);`,
    `open(list)[${at}] = ${kind.stranger};`,
    `open(list)[0] = ${kind.stranger};`,
    `open(list)[${at}] = ${element};`,
    `open(list)[${at}] = NaN;`,
    `delete list[${at}];`,
    `for (let k = 0; k < list.length; k += 2) delete list[k];`,
    `open(list)[${length + r.pick([1, 50, 60000])}] = ${element};`,
    `Object.freeze(list);`,
    `Object.seal(list);`,
    `Object.preventExtensions(list);`,
    `Object.defineProperty(list, ${at}, { get: () => ${element}, set(value) { calls += 100000; }, configurable: true, enumerable: true });`,
    `Object.defineProperty(list, ${at}, { value: ${element}, writable: false, configurable: true, enumerable: true });`,
    `Object.defineProperty(list, "length", { writable: false });`,
    `list.sort((a, b) => ${kind.honest});`,
    `list.sort((a, b) => -1);`,
    `list.sort();`,
    `sink = list.toSorted((a, b) => ${kind.honest}).length;`,
    `list.reverse();`,
    `list.fill(${element});`,
    `list.copyWithin(0, ${at});`,
    `Object.setPrototypeOf(list, { __proto__: Array.prototype, extra: 1 });`,
    `Object.setPrototypeOf(list, null);`,
    `open(list).name = "named";`,
    `collect();`,
    `churn(${r.pick([100, 3000])});`,
  ]);
}

function drawTypedArrayAction(r: Random, length: number, size: number, isResizable: boolean): string {
  const at = String(r.below(Math.max(1, length)));
  return r.pick([
    `throw new RangeError("call " + calls);`,
    `list[${at}] = 3;`,
    `list.fill(1);`,
    `list.reverse();`,
    `list.sort();`,
    `list.sort((a, b) => b - a);`,
    `list.set([1, 2].slice(0, list.length));`,
    `sink = list.toSorted().length;`,
    isResizable ? `buffer.resize(${(length >> 1) * size});` : `list.copyWithin(0, ${at});`,
    isResizable ? `buffer.resize(0);` : `list[0] = 9;`,
    isResizable ? `buffer.resize(${(length + r.between(1, length + 1)) * size});` : `list.fill(2, ${at});`,
    `sink = buffer.transfer().byteLength;`,
    `collect();`,
    `churn(${r.pick([100, 3000])});`,
  ]);
}

function drawComparator(r: Random, typed: boolean, type: string, honest: string, drawAction: () => string, length: number) {
  const [answer, isNumber] = drawAnswer(r, honest);
  const steps: string[] = [`calls++;`];
  const mostCalls = Math.max(2, length * 2);
  for (let k = r.weighted([[3, 0], [5, 1], [2, 2]]); k > 0; k--) // prettier-ignore
    steps.push(`if (calls === ${r.chance(0.5) ? r.between(1, 4) : r.between(1, mostCalls)}) { ${drawAction()} }`);
  if (r.chance(0.15)) steps.push(`if ((calls & ${r.pick([7, 63])}) === 0) churn(${r.pick([20, 200])});`);
  steps.push(`return ${typed && !isNumber ? `open(${answer})` : answer};`);
  const parameters = typed ? `a: ${type}, b: ${type}` : `a, b`;
  const result = typed ? `: number` : ``;
  const body = `{\n      ${steps.join("\n      ")}\n    }`;
  return r.weighted([
    [6, `(${parameters})${result} => ${body}`],
    [2, `function (${parameters})${result} ${body}`],
    [1, `((${parameters})${result} => ${body}).bind(null)`],
    [1, `new Proxy((${parameters})${result} => ${body}, {})`],
  ]);
}

function drawCall(r: Random, comparator: string): string {
  return r.weighted([
    [7, `list.sort(${comparator})`],
    [3, `list.toSorted(${comparator})`],
    [1, `Array.prototype.sort.call(list, ${comparator})`],
  ]);
}

// The loop makes the call of the sort count as hot, so that it is compiled as a call of the compiler's own sort behind a test.
function finish(scene: number, typed: boolean, setup: string, call: string): string {
  return `function scene${scene}()${typed ? ": void" : ""} {
  for (let turn = 0; turn < 2; turn++) {
  ${setup}
  let calls = 0;
  let outcome = "";
  try {
    const result = ${call};
    outcome = open(result) === list ? "itself" : "another: " + describe(result);
  } catch (error) {
    outcome = "threw " + say(error);
  }
  console.log("scene ${scene}:", outcome, "|", calls, "|", describe(list));
  }
}
scene${scene}();`;
}

function drawArrayScene(r: Random, typed: boolean, scene: number): string {
  const kind = r.pick(kinds);
  const length = r.pick(lengths);
  const order = drawOrder(r, length);
  const element = kind.make("rank", "i");
  const listType = typed ? `: Array<${kind.type}>` : ``;
  const rank = `const rank = ${order};`;
  const keepsHoles = r.chance(0.15) ? `if (rank % ${r.between(2, 6)} === 0) continue; ` : ``;
  const made = r.weighted([
    [6, `const list${listType} = [];\n  for (let i = 0; i < ${length}; i++) { ${rank} list.push(${element}); }`],
    [3, `const list${listType} = new Array(${length});\n  for (let i = 0; i < ${length}; i++) { ${rank} ${keepsHoles}list[i] = ${element}; }`], // prettier-ignore
    [1, `const list${listType} = Array.from({ length: ${length} }, (_, i) => { ${rank} return ${element}; });`],
    [1, `const list${listType} = new Rows${typed ? `<${kind.type}>` : ``}();\n  for (let i = 0; i < ${length}; i++) { ${rank} list.push(${element}); }`], // prettier-ignore
    [kind.literal && length <= 65 ? 4 : 0, `const list${listType} = [${Array.from({ length }, () => kind.literal?.(r.below(50))).join(", ")}];`], // prettier-ignore
  ]);
  const another = kind.make(String(r.below(1000)), "-2");
  const then = r.weighted([
    [8, ``],
    [3, `list.shift();`],
    [2, `list.unshift(${another});`],
    [2, `list.splice(0, ${r.between(1, 3)});`],
    [2, `list.splice(0, 0, ${another});`],
    [1, `for (let k = 0; k < ${Math.min(40, length >> 2)}; k++) list.shift();`],
    [1, `delete list[${r.below(Math.max(1, length))}];`],
    [1, `list.length = ${length + r.between(1, 20)};`],
    [1, `open(list)[${length + r.pick([2, 60000])}] = ${another};`],
    [1, `open(list).name = "named";`],
    [1, `Object.freeze(list);`],
    [1, `Object.seal(list);`],
    [1, `Object.preventExtensions(list);`],
    [1, `Object.defineProperty(list, "length", { writable: false });`],
  ]);
  const comparator = drawComparator(r, typed, kind.type, kind.honest, () => drawArrayAction(r, kind, length), length);
  return finish(scene, typed, `${made}\n  ${then}`, drawCall(r, comparator));
}

function drawTypedArrayScene(r: Random, typed: boolean, scene: number): string {
  const [name, size] = r.pick<[string, number]>([["Float64Array", 8], ["Float32Array", 4], ["Int32Array", 4], ["Int16Array", 2], ["Uint8Array", 1]]); // prettier-ignore
  const length = r.pick(lengths);
  const isResizable = r.chance(0.5);
  const options = isResizable ? `, { maxByteLength: ${(length * 2 + 2) * size} }` : ``;
  const view = isResizable && r.chance(0.3) ? `buffer, 0, ${length}` : `buffer`;
  const setup = `const buffer${typed ? ": any" : ""} = new (open(ArrayBuffer))(${length * size}${options});
  const list = new ${name}(${view});
  for (let i = 0; i < ${length}; i++) list[i] = ${r.chance(0.2) ? `special(${drawOrder(r, length)})` : `(${drawOrder(r, length)}) + 0.5`};`;
  const comparator = drawComparator(r, typed, "number", "a - b", () => drawTypedArrayAction(r, length, size, isResizable), length);
  return finish(scene, typed, setup, r.chance(0.7) ? `list.sort(${comparator})` : `list.toSorted(${comparator})`);
}

export function generate(r: Random, typed: boolean): string {
  const scenes: string[] = [];
  for (let scene = 0, count = r.between(4, 10); scene < count; scene++)
    scenes.push(r.chance(0.12) ? drawTypedArrayScene(r, typed, scene) : drawArrayScene(r, typed, scene));
  const any = typed ? ": any" : "";
  const number = typed ? ": number" : "";
  const text = typed ? ": string" : "";
  return `const open = (value${typed ? ": unknown" : ""})${any} => value;
class Rows${typed ? "<T>" : ""} extends Array${typed ? "<T>" : ""} {}
let state = ${r.below(1 << 30)};
let sink = 0;
const junk${typed ? ": unknown[]" : ""} = [];
function random()${number} {
  state = (Math.imul(state, 1664525) + 1013904223) | 0;
  return state >>> 8;
}
function special(rank${number})${number} {
  return rank % 11 === 0 ? NaN : rank % 13 === 0 ? -0 : rank % 17 === 0 ? Infinity : rank % 19 === 0 ? -Infinity : rank + 0.5;
}
function churn(count${number})${typed ? ": void" : ""} {
  for (let i = 0; i < count; i++) junk[i & 1023] = { name: "x" + i, list: [i, i + 0.5] };
}
function collect()${typed ? ": void" : ""} {
  open(globalThis).Bun.gc(true);
}
function mix(value${any})${number} {
  if (typeof value === "number") return value !== value ? 11 : Object.is(value, -0) ? 13 : (value * 4) | 0;
  if (typeof value === "string") return (value.length * 131 + value.charCodeAt(value.length - 1)) | 0;
  if (value === undefined) return 7;
  if (value === null) return 5;
  return ((value.x === undefined ? 3 : value.x * 5) + (value.id === undefined ? 1 : value.id * 977)) | 0;
}
function describe(list${any})${text} {
  let ordered = 0;
  let bag = 0;
  let holes = 0;
  const length = list.length;
  for (let i = 0; i < length; i++) {
    if (!(i in list)) {
      holes++;
      continue;
    }
    const hash = mix(list[i]);
    ordered = (Math.imul(ordered, 31) + hash) | 0;
    bag = (bag + Math.imul(hash, hash | 1)) | 0;
  }
  return Array.isArray(list) + " " + length + " " + ordered + " " + bag + " " + holes;
}
function say(error${any})${text} {
  // Compiled code quotes less of the source text in the message of an engine error.
  return error instanceof Error ? error.name + ": " + error.message.replace(/ \\((In|evaluating) '.*$/, "") : typeof error + " " + String(error);
}
${scenes.join("\n")}
console.log("done", sink, state);
`;
}
