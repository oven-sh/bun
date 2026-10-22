// `return list.join(separator)` is a tail call. The frames that user code sees from inside the built-in, the errors the built-in throws and the depth that recursion reaches are those of plain Bun.
interface Options { list: unknown[]; numbers: number[]; text: string; separator: string; position: number }
const parsed: any = JSON.parse('{"list":[1,2],"numbers":[3,1,2],"text":"a,b","separator":",","position":1}');
function createOptions(values: any): Options {
  return { list: values.list, numbers: values.numbers, text: values.text, separator: values.separator, position: values.position };
}
let frames = "";
function capture(): void {
  frames = (new Error().stack ?? "").split("\n").slice(1).map(line => /at (\S+)/.exec(line)?.[1] ?? "?").filter(name => /^(capture|spy|join|at|slice|concat|indexOf|includes|split|padStart|run|outer|toString|valueOf)/.test(name)).join(" < ");
}
const spyText = { toString() { capture(); return ";"; } };
const spyNumber = { valueOf() { capture(); return 1; } };

function joinInTailPosition(o: Options): string { return o.list.join(o.separator); }
function atInTailPosition(o: Options): unknown { return o.list.at(o.position); }
function sliceInTailPosition(o: Options): unknown[] { return o.list.slice(o.position); }
function concatInTailPosition(o: Options): unknown[] { return o.list.concat(o.numbers); }
function indexOfInTailPosition(o: Options): number { return o.numbers.indexOf(o.position); }
function includesInTailPosition(o: Options): boolean { return o.numbers.includes(o.position); }
function splitInTailPosition(o: Options): string[] { return o.text.split(o.separator); }
function padStartInTailPosition(o: Options): string { return o.text.padStart(6, o.separator); }
const functions: ((o: Options) => unknown)[] = [joinInTailPosition, atInTailPosition, sliceInTailPosition, concatInTailPosition, indexOfInTailPosition, includesInTailPosition, splitInTailPosition, padStartInTailPosition];

function outer(run: (o: Options) => unknown, o: Options): string {
  frames = "";
  let answer: string;
  try { answer = JSON.stringify(run(o)) ?? "undefined"; } catch (error) { answer = (error as Error).constructor.name; }
  return answer + " [" + frames + "]";
}

const usual = createOptions(parsed);
let total = 0;
for (let i = 0; i < 3000; i++) for (const run of functions) total += String(run(usual)).length;
console.log(total);

const holey: unknown[] = [1, , 3];
const withOwnJoin: any = [1, 2]; withOwnJoin.join = () => { capture(); return "own"; };
class List extends Array<unknown> { at(): unknown { capture(); return "subclass"; } }
const cases: [string, any][] = [
  ["usual", {}], ["separator is an object", { separator: spyText }], ["separator is undefined", { separator: undefined }], ["separator is null", { separator: null }], ["separator is a number", { separator: 7 }],
  ["position is an object", { position: spyNumber }], ["position is undefined", { position: undefined }], ["position is text", { position: "1" }],
  ["an element has toString", { list: [spyText, 2] }], ["list has a hole", { list: holey }], ["list has its own join", { list: withOwnJoin }], ["list is of a subclass", { list: List.from([1, 2]) }],
  ["list is undefined", { list: undefined }], ["list is null", { list: null }], ["list is array-like", { list: { length: 1, 0: "x", join: Array.prototype.join, at: Array.prototype.at, slice: Array.prototype.slice, concat: Array.prototype.concat } }],
  ["list is a proxy", { list: new Proxy([1, 2], { get(target, key, receiver) { if (key === "length") capture(); return Reflect.get(target, key, receiver); } }) }],
  ["numbers is undefined", { numbers: undefined }], ["numbers is frozen", { numbers: Object.freeze([1, 2]) }], ["text is undefined", { text: undefined }], ["text is a number", { text: 5 }], ["text is an object", { text: new String("p,q") }],
];
for (const [name, changes] of cases) {
  const o = createOptions({ ...parsed, ...changes });
  console.log(name + ": " + functions.map(run => outer(run, o)).join(" | "));
}

// A chain of calls that ends in a built-in each time it comes back: the recursion goes through user code that the built-in calls.
let deepest = 0;
function descend(depth: number, o: Options): string {
  deepest = depth;
  if (depth === 500) return "bottom";
  const step = { toString() { return descend(depth + 1, o); } };
  const list: unknown[] = [step];
  return list.join(o.separator);
}
console.log(descend(0, usual), deepest);
