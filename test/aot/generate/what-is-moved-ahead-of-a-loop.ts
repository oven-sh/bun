// Programs for three folders: values-that-are-there-only-behind-a-test, callees-replaced-behind-their-test and lists-changed-behind-their-test.
// The compiler has many ways to do the work of a loop once, ahead of its turns: a variable goes around the loop in a register, a read or a test leaves the loop, what a closure captured is
// read ahead, a text is put together in a buffer, a loop is copied for each kind of list, the room for a list is planned, a rare way becomes a function of its own. Each program here is
// shaped for one of these, and in each the loop is also entered, or goes on, where the value that is looked at is not there, is another function, or is a list that has changed.
// Whatever is moved, the program prints what plain Bun prints.

const mix = `function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
`;
const records = `type Result = { kind: 0; part: number[] } | { kind: 1; name: string } | { kind: 2 };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
`;
const steps = `type Step = (x: number) => number;
function picker(list: number[]): Step {
  return x => list[x & 3]! + list.length;
}
function adder(n: number): Step {
  return x => x + n;
}
`;
const longRarePath = (use: (k: number) => string) =>
  Array.from({ length: 24 }, (_, k) => `      t = ((t ^ ${k + 5}) * 3 + ${k % 6 === 0 ? use(k) : "j"}) | 0;`).join(
    "\n",
  );

/** By the name of the file. The first line of each text says what the program does. */
export const values: Record<string, string> = {
  "the-truth-of-a-member-that-some-records-lack-is-asked-by-a-function-it-is-handed-to.js": `// A function without types is handed the member of a record that only some records have, and asks in every turn for its truth before it reads an element.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function make(i) {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function walk(part, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (part) sum = mix(sum, part[j % 3] + part.length);
    else sum += 1;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, walk(make(i).part, 24));
console.log(total);
`,
  "the-truth-of-a-member-that-some-records-lack-is-asked-in-every-turn.js": `// A function without types asks in every turn whether the record has a list, by the truth of the member, and reads the list behind that.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function make(i) {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i, n) {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.part) sum = mix(sum, r.part[j % 3] + r.part.length);
    else if (r.name) sum = mix(sum, r.name.length);
    else sum += 1;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 24));
console.log(total);
`,
  "a-map-and-a-set-that-some-records-lack-are-filled-by-counted-loops.ts": `// The map and the set of a record are filled by counted loops, behind the test of the kind inside the turn. Some records have neither.
${mix}type Result = { kind: 0; index: Map<number, number>; members: Set<number> } | { kind: 1; name: string };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  return { kind: 0, index: new Map([[i, 1]]), members: new Set([i]) };
}
function fill(r: Result, n: number): number {
  let skipped = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) r.index.set(j, j * 2);
    else skipped++;
  }
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) r.members.add(j * 3);
    else skipped++;
  }
  return r.kind === 0 ? r.index.size * 100 + r.members.size : skipped + r.name.length;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, fill(make(i), 40));
console.log(total);
`,
  "the-counter-is-compared-with-a-member-out-of-a-text-that-some-records-lack.js": `// The records come out of JSON texts. A loop compares its counter with a member that is a number, a text of digits, or not there, behind a test of the kind.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function work(text, n) {
  const r = JSON.parse(text);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0 && j < r.limit) sum = mix(sum, j);
    else sum += 1;
  }
  return sum;
}
const texts = ['{"kind":0,"limit":20}', '{"kind":0,"limit":"7"}', '{"kind":1}', '{"kind":0,"limit":12.5}', '{"kind":0}', '{"kind":0,"limit":null}', '{"kind":0,"limit":[9]}'];
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(texts[i % texts.length], 24));
console.log(total);
`,
  "a-record-read-by-every-turn-of-a-loop-that-has-no-turns-ahead-of-its-store.ts": `// Every turn of a loop reads a constant of the module and looks through two of its members. Ahead of the declaration the loop is entered with no turns.
${mix}function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, table.inner.part[j % 3]! + table.inner.part.length + table.name.length + (table.isWide ? 1 : 2));
  return sum;
}
console.log(work(process.argv.length - 2));
const table = { inner: { part: [process.argv.length, 5, 6] }, name: "name" + process.argv.length, isWide: process.argv.length > 1 };
console.log(work(40));
`,
  "a-list-filled-from-a-set-and-a-map-that-some-records-lack.ts": `// A new list and a new map are filled by loops that walk the set and the map of a record. The loops stand behind the test of the kind, and some records have neither.
${mix}type Result = { kind: 0; members: Set<number>; index: Map<number, number> } | { kind: 1; name: string };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  return {
    kind: 0,
    members: new Set([i, i + 1, i + 2, 5]),
    index: new Map([
      [i, 1],
      [i + 1, 2],
    ]),
  };
}
function work(i: number): number {
  const r = make(i);
  const copy: number[] = [];
  const turned = new Map<number, number>();
  if (r.kind === 0) {
    for (const member of r.members) copy.push(member * 2);
    for (const [key, value] of r.index) turned.set(value, key);
  }
  return copy.length * 100 + turned.size * 10 + (copy[2] ?? -1) + (turned.get(2) ?? -1);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i));
console.log(total);
`,
  "a-record-in-a-variable-that-goes-around-the-loop.ts": `// Every turn reads a variable of the module that holds a record, and a turn in eight stores another record, which may lack the list that the other turns look at.
${mix}${records}let current: Result = make(0);
function work(from: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const r = current;
    if (r.kind === 0) sum = mix(sum, r.part[j % 3]! + r.part.length);
    else sum = mix(sum, r.kind === 1 ? r.name.length : -1);
    if ((j & 7) === 7) current = make(from + j);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(i, 40));
console.log(total);
`,
  "a-list-read-in-a-block-that-may-not-run-ahead-of-its-store.ts": `// A loop reads a constant of the module only in a block behind a flag. The loop runs once ahead of the declaration, with the flag down.
${mix}function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum += j;
    if (isOpen) sum = mix(sum, table.part[j % 3]! + table.part.length + table.name.length);
  }
  return sum;
}
let isOpen = false;
console.log(work(40));
const table = { part: [process.argv.length, 5, 6], name: "name" + process.argv.length };
isOpen = true;
console.log(work(40));
`,
  "a-closure-made-only-for-records-that-hold-the-list.ts": `// A closure over the list of a record is made ahead of the loop, only for the records that hold a list. The loop calls it behind a test.
${mix}${records}function picker(list: number[]): (x: number) => number {
  return x => list[x % 3]! + list.length;
}
function work(i: number, n: number): number {
  const r = make(i);
  const look = r.kind === 0 ? picker(r.part) : undefined;
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, look === undefined ? j : look(j));
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 24));
console.log(total);
`,
  "a-text-that-begins-with-the-name-of-some-records.ts": `// A text is put together in a loop. It begins with the name of a record, which only some records have, and the loop stands behind the test of the kind.
${mix}${records}function work(i: number, n: number): string {
  const r = make(i);
  let text = "";
  if (r.kind === 1) {
    text = r.name;
    for (let j = 0; j < n; j++) text += "," + j;
  }
  return text;
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const text = work(i, 12);
  total = mix(total, text.length + (text.length ? text.charCodeAt(4) : 0));
}
console.log(total, work(3, 3), work(4, 3) === "");
`,
  "a-text-inside-a-text-that-begins-with-the-name-of-some-records.ts": `// An outer loop puts lines together and an inner loop the cells of a line. A line begins with the name of a record, which only some records have.
${mix}${records}function work(from: number, rows: number, cells: number): string {
  let page = "";
  for (let row = 0; row < rows; row++) {
    const r = make(from + row);
    let line = "-";
    if (r.kind === 1) {
      line = r.name + ":";
      for (let cell = 0; cell < cells; cell++) line += cell + ";";
    }
    page += line + "|";
  }
  return page;
}
let total = 0;
for (let i = 0; i < 200; i++) total = mix(total, work(i, 9, 5).length);
console.log(total, work(0, 5, 2));
`,
  "a-record-tested-in-every-turn-and-replaced-at-its-end.ts": `// The variable of a loop holds a record that every turn tests and then replaces. The loop ends at the first record without a list.
${mix}${records}function work(i: number): number {
  let sum = 0;
  let r = make(i);
  for (let j = 0; ; j++) {
    if (r.kind !== 0) break;
    sum = mix(sum, r.part[j % 3]! + r.part.length);
    r = make(i + j + 1);
  }
  return mix(sum, r.kind === 1 ? r.name.length : -1);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i));
console.log(total);
`,
  "a-list-or-a-text-in-a-variable-tested-in-every-turn.ts": `// A variable of the module holds a list or a text. Every turn reads it and asks which, and the loop first runs ahead of the store, behind a flag.
${mix}function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (!isOpen) {
      sum += j;
      continue;
    }
    const now = either;
    if (typeof now === "string") sum = mix(sum, now.length + now.charCodeAt(j % now.length));
    else sum = mix(sum, now[j % 3]! + now.length);
    if ((j & 7) === 7) either = j & 8 ? "text" + j : [j, j + 1, j + 2];
  }
  return sum;
}
let isOpen = false;
console.log(work(40));
let either: string | number[] = [process.argv.length, 2, 3];
isOpen = true;
console.log(work(40), work(40));
`,
  "a-member-that-some-records-lack-is-handed-to-a-loop-of-no-turns.js": `// A function without types walks what it is given. For a record without a list it is given the member that is not there, and the number of turns is zero.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function make(i) {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function walk(part, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, part[j % 3] + part.length);
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const r = make(i);
  total = mix(total, walk(r.part, r.kind === 0 ? 24 : 0));
}
console.log(total);
`,
  "an-inner-loop-entered-again-looks-at-a-member-that-some-records-lack.js": `// The record is made in front of two loops. The inner loop, which is entered once a turn of the outer one, looks at the list, and has no turns for a record without one.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function make(i) {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i, rows) {
  const r = make(i);
  const part = r.part;
  const cells = r.kind === 0 ? 3 : 0;
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    sum += row;
    for (let cell = 0; cell < cells; cell++) sum = mix(sum, part[cell] + part.length);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 8));
console.log(total);
`,
  "a-list-of-one-of-three-classes-that-some-records-lack.ts": `// The list of a record is an array or one of two typed arrays, and some records have none. A loop that runs often reads its elements behind the test of the kind.
${mix}type Result = { kind: 0; part: number[] | Float64Array | Uint8Array } | { kind: 1; name: string };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 3 === 0) return { kind: 0, part: new Float64Array([i, i + 0.5, i + 2]) };
  if (i % 3 === 1) return { kind: 0, part: new Uint8Array([i, i + 1, i + 2]) };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) sum = mix(sum, r.part[j % 3]! + r.part[(j + 1) % 3]!);
    else sum = mix(sum, r.name.length);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 200));
console.log(total);
`,
  "an-object-of-some-records-beside-records-that-end-with-a-flag.ts": `// A record holds a flag or an object, so the fields of one kind of record reach further than those of the other. A loop that runs often reads the object behind the test of the kind.
${mix}type Result = { kind: 0; flag: boolean } | { kind: 1; inner: { x: number } };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, inner: { x: i } };
  return { kind: 0, flag: i % 2 === 0 };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) sum = mix(sum, r.flag ? 3 : 4);
    else sum = mix(sum, r.inner.x);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 100));
console.log(total);
`,
  "three-members-of-some-records-beside-records-with-a-flag-and-an-object.ts": `// A record holds a flag and an object, or a name, a list and an object. A loop that runs often reads all the members of a record behind the test of the kind, and some calls ask for no turn.
${mix}type Result = { kind: 0; flag: boolean; inner: { x: number } } | { kind: 1; name: string; part: number[]; other: { x: number } };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i, part: [i, i + 1], other: { x: i } };
  return { kind: 0, flag: i % 2 === 0, inner: { x: i } };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) sum = mix(sum, (r.flag ? 3 : 4) + r.inner.x);
    else sum = mix(sum, r.name.length + r.part[1]! + r.other.x);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, i % 5 === 0 ? 0 : 100));
console.log(total);
`,
  "a-list-and-a-map-filled-from-a-list-that-some-records-lack.ts": `// A new list and a new map are filled in loops that run up to the length of the list of a record. The loops stand behind the test of the kind.
${mix}${records}function work(i: number): number {
  const r = make(i);
  const copy: number[] = [];
  const index = new Map<number, number>();
  if (r.kind === 0) {
    for (let j = 0; j < r.part.length; j++) copy.push(r.part[j]! * 2);
    for (let j = 0; j < r.part.length; j++) index.set(r.part[j]!, j);
  }
  return copy.length * 100 + index.size * 10 + (copy[2] ?? -1);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i));
console.log(total);
`,
  "the-characters-of-a-joined-name-that-some-records-lack.ts": `// The name of a record is a text joined of two, and only some records have one. A loop reads its characters behind the test of the kind, and compares its counter with a number that only those records have.
${mix}type Result = { kind: 0; part: number[] } | { kind: 1; name: string; limit: number };
function make(i: number): Result {
  if (i % 3 === 1) return { kind: 1, name: "a name that is joined " + i + " of several pieces " + i * 3, limit: 20 + (i % 5) + 0.5 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 1 && j < r.limit) sum = mix(sum, r.name.charCodeAt(j));
    else sum += 1;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 30));
console.log(total);
`,
  "a-long-rare-way-looks-at-the-list-of-a-record.ts": `// One turn in many takes a long way, which looks at the list of the record behind the test of the kind. The other turns look at nothing.
${mix}${records}function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum += j;
    if (j === 17 && r.kind === 0) {
      let t = sum | 0;
${longRarePath(k => `r.part[${k % 3}]!`)}
      sum = mix(sum, t + r.part.length);
    }
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 24));
console.log(total);
`,
  "a-test-that-nearly-always-passes-in-front-of-a-read-through-two-members.ts": `// Nearly every record holds an object that holds a typed array, and the loop reads through both behind the test of the kind. One record in ninety-seven holds neither.
${mix}type Result = { kind: 0; part: { samples: Float64Array } } | { kind: 1 };
function make(i: number): Result {
  if (i % 97 === 41) return { kind: 1 };
  return { kind: 0, part: { samples: new Float64Array([i, i + 1, i + 2, i + 3]) } };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) if (r.kind === 0) sum += r.part.samples[j & 3]!;
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 64));
console.log(total);
`,
  "a-generator-with-many-steps-and-a-delegation-walked-by-a-loop.js": `// A generator has ten steps, one of them behind a test and one that hands over to a list. A loop walks it and adds up what it gives.
function* steps(x) {
  yield x + 0;
  if (x > 1) yield 1;
  yield x + 2;
  yield x + 3;
  yield x + 4;
  yield x + 5;
  yield x + 6;
  yield x + 7;
  yield* [8, x];
  yield x + 9;
}
let sum = 0;
for (const each of steps(2)) sum += each;
console.log(sum);
`,
};

export const callees: Record<string, string> = {
  "a-callee-found-under-a-key-of-the-global-object-or-not-there.ts": `// The callee is read from the global object under a key put together at run time, ahead of the loop. Under some keys there is a closure, a built-in function or a number, under others nothing, and the loop calls it behind a test.
${mix}${steps}const shared = globalThis as unknown as Record<string, unknown>;
shared["step" + process.argv.length] = picker([1, 2, 3, 4]);
shared["step" + (process.argv.length + 1)] = adder(7);
shared["step" + (process.argv.length + 2)] = Math.abs;
shared["step" + (process.argv.length + 3)] = 5;
function work(key: string, n: number): number {
  const step = shared[key];
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, typeof step === "function" ? step(j) : -1);
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work("step" + (2 + (i % 6)), 24));
console.log(total);
`,
  "a-callee-called-by-every-turn-of-a-loop-that-has-no-turns-ahead-of-its-store.ts": `// Every turn of a loop calls two constants of the module. Ahead of the declarations the loop is entered with no turns.
${mix}${steps}function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, look(j) + more(j));
  return sum;
}
console.log(work(process.argv.length - 2));
const look = picker([process.argv.length, 5, 6, 7]);
const more = adder(process.argv.length);
console.log(work(40));
`,
  "a-list-filled-from-a-set-while-the-callee-takes-members-out.ts": `// A new list is filled by a loop that walks a set, with what a function gives back. The function is replaced by one that takes members out of the set and puts others in.
${mix}type Step = (x: number) => number;
function work(source: Set<number>, first: Step, second: Step, at: number): number {
  let step = first;
  const copy: number[] = [];
  let turn = 0;
  for (const member of source) {
    if (turn++ === at) step = second;
    copy.push(step(member));
    if (turn > 20) break;
  }
  return copy.length * 100 + (copy[copy.length - 1] ?? -1);
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const source = new Set([i, i + 1, i + 2, i + 3, i + 4, i + 5]);
  total = mix(
    total,
    work(
      source,
      x => x * 2,
      x => {
        source.delete(x + 1);
        if (x & 1) source.add(x + 100);
        return x * 3;
      },
      i % 8,
    ),
  );
}
console.log(total);
`,
  "a-callee-in-a-variable-that-goes-around-the-loop.ts": `// Every turn calls what a variable of the module holds, and a turn in eight stores another function, with other captures or with none.
${mix}${steps}let held: Step = picker([1, 2, 3, 4]);
function work(from: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum = mix(sum, held(j));
    if ((j & 7) === 7) held = (from + j) % 3 === 0 ? adder(from) : (from + j) % 3 === 1 ? picker([from, j, 7, 8]) : Math.abs;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(i, 40));
console.log(total);
`,
  "a-callee-called-in-a-block-that-may-not-run-ahead-of-its-store.ts": `// A loop calls a constant of the module only in a block behind a flag. The loop runs once ahead of the declaration, with the flag down.
${mix}${steps}function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum += j;
    if (isOpen) sum = mix(sum, look(j) + more(j));
  }
  return sum;
}
let isOpen = false;
console.log(work(40));
const look = picker([process.argv.length, 5, 6, 7]);
const more = adder(process.argv.length);
isOpen = true;
console.log(work(40));
`,
  "the-captures-of-a-parameter-that-may-be-another-function-or-none.ts": `// The callee is a parameter, so it stands ahead of the loop. It is a closure over a list, a closure over a number, a function that captures nothing, or undefined, and the loop calls it behind a test.
${mix}${steps}function doubled(x: number): number {
  return x * 2;
}
function work(step: Step | undefined, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, step === undefined ? j : step(j));
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 5 === 0 ? undefined : i % 5 === 1 ? adder(i) : i % 5 === 2 ? doubled : picker([i, 1, 2, 3]), 24));
console.log(total);
`,
  "a-text-put-together-from-what-a-callee-gives.ts": `// A text is put together in a loop from what a function gives back. The function is replaced in the middle of the loop by one that captured another text.
${mix}type Word = (x: number) => string;
function tagger(tag: string): Word {
  return x => tag + x;
}
function work(first: Word, second: Word, at: number, n: number): string {
  let word = first;
  let text = word(0);
  for (let j = 1; j < n; j++) {
    if (j === at) word = second;
    text += "," + word(j);
  }
  return text;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(tagger("a" + i), tagger("second" + i), i % 9, 8).length);
console.log(total, work(tagger("a"), tagger("b"), 2, 4), work(tagger("a"), String, 1, 3));
`,
  "a-text-inside-a-text-put-together-from-what-a-callee-gives.ts": `// An outer loop puts lines together and an inner loop the cells of a line, each from what a function gives back. A turn of the inner loop replaces the function.
${mix}type Word = (x: number) => string;
function tagger(tag: string): Word {
  return x => tag + x;
}
function work(first: Word, second: Word, at: number, rows: number, cells: number): string {
  let word = first;
  let page = "";
  for (let row = 0; row < rows; row++) {
    let line = word(row) + ":";
    for (let cell = 0; cell < cells; cell++) {
      if (row * cells + cell === at) word = second;
      line += word(cell) + ";";
    }
    page += line + "|";
  }
  return page;
}
let total = 0;
for (let i = 0; i < 200; i++) total = mix(total, work(tagger("a" + i), tagger("second" + i), i % 13, 4, 3).length);
console.log(total, work(tagger("a"), tagger("b"), 4, 3, 2));
`,
  "a-callee-tested-in-every-turn-and-replaced-by-what-it-gives.ts": `// The variable of a loop holds a function that every turn tests, calls and replaces by what the call gives back. The loop ends when that is undefined.
${mix}type Link = (x: number) => Link | undefined;
let seen = 0;
function link(list: number[], left: number): Link {
  return x => {
    seen = mix(seen, list[x & 1]! + left);
    return left === 0 ? undefined : left % 3 === 0 ? last : link([left, x], left - 1);
  };
}
const last: Link = x => {
  seen = mix(seen, x);
  return undefined;
};
function work(first: Link | undefined): number {
  let turns = 0;
  for (let next = first; next !== undefined; turns++) next = next(turns);
  return turns;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 6 === 5 ? undefined : link([i, i + 1], i % 6)));
console.log(total, seen);
`,
  "a-callee-or-a-number-in-a-variable-tested-in-every-turn.ts": `// A variable of the module holds a function or a number. Every turn reads it and asks which, and the loop first runs ahead of the store, behind a flag.
${mix}${steps}function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (!isOpen) {
      sum += j;
      continue;
    }
    const now = either;
    sum = mix(sum, typeof now === "function" ? now(j) : now);
    if ((j & 7) === 7) either = j & 8 ? j : j & 16 ? adder(j) : picker([j, 1, 2, 3]);
  }
  return sum;
}
let isOpen = false;
console.log(work(40));
let either: Step | number = picker([process.argv.length, 2, 3, 4]);
isOpen = true;
console.log(work(40), work(40));
`,
  "what-is-no-function-is-handed-to-a-loop-of-no-turns.js": `// A function without types calls what it is given in a loop. Now and then it is given undefined, null, a number or an object, and then the number of turns is zero.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function picker(list) {
  return x => list[x & 3] + list.length;
}
function walk(step, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, step(j));
  return sum;
}
const strangers = [undefined, null, 5, { call: 1 }, "text"];
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, i % 7 === 3 ? walk(strangers[i % 5], 0) : walk(picker([i, 1, 2, 3]), 24));
console.log(total);
`,
  "an-inner-loop-entered-again-calls-what-a-turn-of-the-outer-loop-replaced.js": `// The callee is read in front of two loops. The inner loop, which is entered once a turn of the outer one, calls it, and a turn of the outer loop replaces it.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function picker(list) {
  return x => list[x & 3] + list.length;
}
function adder(n) {
  return x => x + n;
}
function work(first, second, at, rows) {
  let step = first;
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    if (row === at) step = second;
    for (let cell = 0; cell < 3; cell++) sum = mix(sum, step(cell));
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(picker([i, 1, 2, 3]), i & 1 ? adder(i) : Math.sqrt, i % 9, 8));
console.log(total);
`,
  "closures-over-lists-of-three-classes.ts": `// The callee has captured an array or one of two typed arrays and reads two of its elements. It is replaced in the middle of a loop that runs often.
${mix}type Step = (x: number) => number;
function picker(list: number[] | Float64Array | Uint8Array): Step {
  return x => list[x % 3]! + list[(x + 1) % 3]!;
}
function work(first: Step, second: Step, at: number, n: number): number {
  let step = first;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === at) step = second;
    sum = mix(sum, step(j));
  }
  return sum;
}
const made = (i: number): Step => picker(i % 3 === 0 ? [i, i + 1, i + 2] : i % 3 === 1 ? new Float64Array([i, i + 0.5, i + 2]) : new Uint8Array([i, i + 1, i + 2]));
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(made(i), made(i + 1 + (i % 2)), i % 250, 200));
console.log(total);
`,
  "a-list-filled-with-what-a-callee-gives-while-the-callee-cuts-the-source.ts": `// A new list is filled in a loop up to the length of another list, with what a function gives back. The function is replaced by one that cuts the other list.
${mix}type Step = (x: number) => number;
function work(source: number[], first: Step, second: Step, at: number): number {
  let step = first;
  const copy: number[] = [];
  for (let j = 0; j < source.length; j++) {
    if (j === at) step = second;
    copy.push(step(source[j]!));
  }
  return copy.length * 100 + (copy[copy.length - 1] ?? -1);
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const source = [i, i + 1, i + 2, i + 3, i + 4, i + 5];
  total = mix(
    total,
    work(
      source,
      x => x * 2,
      x => {
        source.length = 4;
        return x * 3;
      },
      i % 8,
    ),
  );
}
console.log(total);
`,
  "one-of-nine-callees-that-stands-ahead-of-the-loop-or-none.ts": `// The callee is one of nine functions, or undefined, and does not change in the loop. The loop calls it behind a test.
${mix}${steps}const all: (Step | undefined)[] = [
  picker([1, 2, 3, 4]),
  adder(5),
  x => x * 2,
  x => x - 1,
  x => x ^ 5,
  Math.abs,
  Math.floor,
  x => (x << 2) + 1,
  adder.bind(null, 3)(),
  undefined,
];
function work(step: Step | undefined, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, step ? step(j) : -1);
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(all[i % all.length], 24));
console.log(total);
`,
  "a-long-rare-way-calls-what-the-turn-before-it-replaced.ts": `// One turn in many takes a long way, which calls the function several times. The turn before it has replaced the function.
${mix}${steps}function work(first: Step, second: Step, n: number): number {
  let step = first;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum = mix(sum, step(j));
    if (j === 16) step = second;
    if (j === 17) {
      let t = sum | 0;
${longRarePath(k => `step(${k})`)}
      sum = mix(sum, t);
    }
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(picker([i, 1, 2, 3]), i & 1 ? adder(i) : picker([9, 9, 9, i]), 24));
console.log(total);
`,
  "a-test-that-nearly-always-passes-in-front-of-a-callee-that-reads-through-two-captures.ts": `// Nearly every time the callee is a closure over an object that holds a typed array. One time in ninety-seven it is undefined, or a closure over a number.
${mix}type Step = (x: number) => number;
function sampler(box: { samples: Float64Array }): Step {
  return x => box.samples[x & 3]!;
}
function adder(n: number): Step {
  return x => x + n;
}
function work(step: Step | undefined, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) if (step !== undefined) sum += step(j);
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 97 === 41 ? undefined : i % 97 === 42 ? adder(i) : sampler({ samples: new Float64Array([i, i + 1, i + 2, i + 3]) }), 64));
console.log(total);
`,
};

export const lists: Record<string, string> = {
  "the-truth-of-a-list-that-may-be-missing-is-asked-in-every-turn.js": `// A function without types asks in every turn whether it was given a list, by its truth, and reads and stores an element behind that. It is given an array, a typed array, undefined, null, zero or an empty text.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function work(list, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (list) {
      sum = mix(sum, list[j & 3] + list.length);
      list[j & 3] = j;
    } else sum += 1;
  }
  return sum;
}
const missing = [undefined, null, 0, ""];
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 5 === 2 ? missing[i & 3] : i & 1 ? [i, 1, 2, 3] : new Float64Array([i, 1, 2, 3]), 24));
console.log(total);
`,
  "a-map-and-a-set-are-filled-by-counted-loops-and-emptied-in-one-turn.ts": `// A map and a set that the function is given are filled by counted loops. One turn empties them, or takes out what the turns before it put in.
${mix}function fill(index: Map<number, number>, members: Set<number>, at: number, n: number): number {
  for (let j = 0; j < n; j++) {
    if (j === at) at & 1 ? index.clear() : index.delete(j - 1);
    index.set(j, j * 2);
  }
  for (let j = 0; j < n; j++) {
    if (j === at) at & 1 ? members.clear() : members.delete((j - 1) * 3);
    members.add(j * 3);
  }
  return index.size * 100 + members.size;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, fill(new Map([[i + 1000, 1]]), new Set([i + 1000]), i % 50, 40));
console.log(total);
`,
  "a-list-read-by-every-turn-of-a-loop-that-has-no-turns-ahead-of-its-store.ts": `// Every turn of a loop reads a list and a typed array out of constants of the module. Ahead of the declarations the loop is entered with no turns.
${mix}function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, list[j & 3]! + samples[j & 3]! + list.length + samples.length);
  return sum;
}
console.log(work(process.argv.length - 2));
const list = [process.argv.length, 5, 6, 7];
const samples = new Float64Array([process.argv.length, 1.5, 2.5, 3.5]);
console.log(work(40));
`,
  "a-list-and-a-map-filled-from-a-set-and-a-map-that-change-their-size.ts": `// A new list and a new map are filled by loops that walk a set and a map. One turn of each loop takes members out of what is walked, or puts members in.
${mix}function work(members: Set<number>, index: Map<number, number>, at: number, grows: boolean): number {
  const copy: number[] = [];
  const turned = new Map<number, number>();
  let turn = 0;
  for (const member of members) {
    if (turn++ === at) {
      if (grows) for (let k = 0; k < 20; k++) members.add(1000 + k);
      else members.clear();
    }
    copy.push(member * 2);
  }
  turn = 0;
  for (const [key, value] of index) {
    if (turn++ === at) {
      if (grows) for (let k = 0; k < 20; k++) index.set(1000 + k, k);
      else index.delete(key + 1);
    }
    turned.set(value, key);
  }
  return copy.length * 10000 + turned.size * 100 + members.size + index.size;
}
let total = 0;
for (let i = 0; i < 400; i++)
  total = mix(
    total,
    work(
      new Set([i, i + 1, i + 2, i + 3]),
      new Map([
        [i, 1],
        [i + 1, 2],
        [i + 2, 3],
      ]),
      i % 6,
      (i & 8) === 0,
    ),
  );
console.log(total);
`,
  "a-list-in-a-variable-that-goes-around-the-loop.ts": `// Every turn reads a list out of a variable of the module. A turn in eight stores a shorter list, a list of fractions or a list with a gap, or cuts the one that is there.
${mix}let held: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
function work(from: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const e = held[j & 7];
    sum = mix(sum, e === undefined ? -1000 : e);
    if ((j & 7) !== 7) continue;
    const way = (from + j) % 4;
    if (way === 0) held = [from, j];
    else if (way === 1) held = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, from + 0.5];
    else if (way === 2) held = [1, , 3, , 5, , 7, from] as number[];
    else held.length = 3;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(i, 40));
console.log(total);
`,
  "a-typed-array-read-out-of-a-field-in-a-block-that-may-not-run.ts": `// A loop reads a typed array out of a field, and its elements, only in a block behind a flag. With the flag down the field holds a typed array whose buffer is gone.
${mix}class Shelf {
  constructor(
    public samples: Float64Array,
    public isOpen: boolean,
  ) {}
}
function work(shelf: Shelf, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum += j;
    if (shelf.isOpen) sum = mix(sum, shelf.samples[j & 3]! + shelf.samples.length);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const samples = new Float64Array([i, i + 1, i + 2, i + 3]);
  if (i % 5 === 2) samples.buffer.transfer();
  total = mix(total, work(new Shelf(samples, i % 5 !== 2), 24));
}
console.log(total);
`,
  "a-list-that-one-closure-reads-and-another-replaces.ts": `// Two closures share a variable that holds a list. A loop calls the one that reads an element, and one turn calls the one that stores a shorter list or cuts the list.
${mix}function shelf(first: number[]) {
  let list = first;
  return {
    read: (j: number): number => {
      const e = list[j & 7];
      return e === undefined ? -1000 : e + list.length;
    },
    replace: (next: number[]): void => {
      list = next;
    },
    cut: (): void => {
      list.length = 2;
    },
  };
}
function work(i: number, at: number, n: number): number {
  const { read, replace, cut } = shelf([i, 1, 2, 3, 4, 5, 6, 7]);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === at) i & 1 ? replace([0.5, i]) : cut();
    sum = mix(sum, read(j));
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, i % 30, 24));
console.log(total);
`,
  "a-text-put-together-from-a-list-that-is-cut.ts": `// A text is put together from the elements of a list of texts, up to the length the list had. One turn cuts the list, so the later turns append "undefined".
${mix}function work(names: string[], at: number): string {
  const n = names.length;
  let text = names[0]!;
  for (let j = 1; j < n; j++) {
    if (j === at) names.length = j;
    text += "," + names[j];
  }
  return text;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(["a" + i, "b", "c" + i, "d", "e"], i % 7).length);
console.log(total, work(["a", "b", "c", "d"], 2), work(["a", "b", "c", "d"], 9));
`,
  "a-text-inside-a-text-put-together-from-rows-that-are-cut.ts": `// An outer loop puts lines together and an inner loop the cells of a line, from a list of lists of texts. A turn of the inner loop cuts its row, and another one the list of rows.
${mix}function work(rows: string[][], at: number): string {
  let page = "";
  let turn = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const n = row.length;
    let line = row[0] + ":";
    for (let c = 1; c < n; c++) {
      if (turn++ === at) r & 1 ? (rows.length = r + 1) : (row.length = c);
      line += row[c] + ";";
    }
    page += line + "|";
  }
  return page;
}
const made = (i: number) => [
  ["a" + i, "b", "c"],
  ["d", "e" + i, "f"],
  ["g", "h", "i" + i],
];
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(made(i), i % 8).length);
console.log(total, work(made(0), 1), work(made(0), 2), work(made(0), 9));
`,
  "a-list-of-one-of-two-classes-tested-in-every-turn-and-replaced.ts": `// The variable of a loop holds an array or a typed array. Every turn reads an element, and some turns replace the list by one of the other class or of another length.
${mix}function work(first: number[] | Float64Array, second: number[] | Float64Array, n: number): number {
  let list = first;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const e = list[j & 7];
    sum = mix(sum, e === undefined ? -1000 : e);
    if ((j & 7) === 5) list = list === first ? second : first;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i & 1 ? [i, 1, 2, 3, 4, 5, 6, 7] : new Float64Array([i, 1.5, 2.5]), i & 2 ? new Float64Array(8).fill(i) : [i, 0.5], 40));
console.log(total);
`,
  "a-list-or-a-typed-array-in-a-variable-tested-in-every-turn.ts": `// A variable of the module holds an array or a typed array. Every turn reads it and an element of it. Some turns store another one, resize the buffer, or take the buffer away.
${mix}let either: number[] | Float64Array = [1, 2, 3, 4, 5, 6, 7, 8];
function tracking(i: number): Float64Array {
  return new Float64Array(new ArrayBuffer(64, { maxByteLength: 128 })).fill(i);
}
function work(from: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const e = either[j & 7];
    sum = mix(sum, (e === undefined ? -1000 : e) + either.length);
    if ((j & 7) !== 7) continue;
    const way = (from + j) % 5;
    if (way === 0) either = tracking(from);
    else if (way === 1) either = [from, j, 0.5];
    else if (either instanceof Float64Array && way === 2) (either.buffer as ArrayBuffer).detached || (either.buffer as ArrayBuffer).resize(16);
    else if (either instanceof Float64Array && way === 3) (either.buffer as ArrayBuffer).detached || (either.buffer as ArrayBuffer).transfer();
    else if (Array.isArray(either)) either.length = 1;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(i, 48));
console.log(total);
`,
  "what-is-no-list-is-handed-to-a-loop-of-no-turns.js": `// A function without types reads and stores the elements of what it is given. Now and then it is given undefined, null, a number, or a typed array without a buffer, and then the number of turns is zero.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function walk(list, n) {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum = mix(sum, list[j] + list.length);
    list[j] = sum & 255;
  }
  return sum;
}
const gone = new Float64Array(4);
gone.buffer.transfer();
const strangers = [undefined, null, 5, gone];
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, i % 7 === 3 ? walk(strangers[i % 4], 0) : walk(i & 1 ? [i, 1, 2, 3] : new Float64Array([i, 1, 2, 3]), 4));
console.log(total);
`,
  "an-inner-loop-entered-again-reads-a-list-that-a-turn-of-the-outer-loop-changed.js": `// The list stands in front of two loops. The inner loop, which is entered once a turn of the outer one, reads its elements, and a turn of the outer loop changes its storage or its length.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function work(list, at, way, rows) {
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    if (row === at) {
      if (way === 0) list.length = 1;
      else if (way === 1) list[1] = 0.5;
      else if (way === 2) list[1] = "text";
      else if (way === 3) delete list[1];
      else if (way === 4) list[100000] = 1;
      else for (let k = 0; k < 40; k++) list.push(k);
    }
    for (let cell = 0; cell < 3; cell++) sum = mix(sum, list[cell] === undefined ? -1000 : list[cell].length === 4 ? 4 : list[cell]);
  }
  return mix(sum, list.length);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work([i, 1, 2], i % 9, i % 6, 8));
console.log(total);
`,
  "a-list-of-one-of-three-classes-that-changes-in-the-loop.ts": `// The list is an array or one of two typed arrays, and a loop that runs often reads two elements a turn. One turn cuts the array, or takes the buffer of the typed array away.
${mix}function work(list: number[] | Float64Array | Uint8Array, at: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === at) {
      if (Array.isArray(list)) list.length = 1;
      else (list.buffer as ArrayBuffer).transfer();
    }
    const a = list[j % 3];
    const b = list[(j + 1) % 3];
    sum = mix(sum, (a === undefined ? -1000 : a) + (b === undefined ? -500 : b));
  }
  return mix(sum, list.length);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 3 === 0 ? [i, i + 1, i + 2] : i % 3 === 1 ? new Float64Array([i, i + 0.5, i + 2]) : new Uint8Array([i, i + 1, i + 2]), i % 250, 200));
console.log(total);
`,
  "a-list-a-map-and-a-set-filled-from-a-source-that-changes-its-length.ts": `// A new list, a new map and a new set are filled in loops up to the length of a source. One turn of each loop cuts the source, or pushes to it.
${mix}function work(source: number[], at: number, grows: boolean): number {
  const copy: number[] = [];
  const index = new Map<number, number>();
  const seen = new Set<number>();
  for (let j = 0; j < source.length && j < 40; j++) {
    if (j === at) grows ? source.push(j, j + 100, j + 200) : source.pop();
    copy.push(source[j]! * 2);
  }
  for (let j = 0; j < source.length && j < 40; j++) {
    if (j === at) grows ? source.push(j + 300) : source.shift();
    index.set(source[j]!, j);
  }
  for (let j = 0; j < source.length && j < 40; j++) {
    if (j === at) grows ? source.unshift(j + 400) : (source.length = j);
    seen.add(source[j]!);
  }
  return copy.length * 10000 + index.size * 100 + seen.size;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work([i, i + 1, i + 2, i + 3, i + 4, i + 5], i % 8, (i & 8) === 0));
console.log(total);
`,
  "the-counter-is-compared-with-a-length-that-a-turn-changes.ts": `// The loop compares its counter with the length of a typed array that is as long as its buffer, and reads the characters of a joined text at the elements. One turn resizes the buffer.
${mix}function work(text: string, at: number, bytes: number): number {
  const places = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 64 }));
  for (let j = 0; j < places.length; j++) places[j] = j * 2;
  let sum = 0;
  for (let j = 0; j < places.length; j++) {
    if (j === at) (places.buffer as ArrayBuffer).resize(bytes);
    sum = mix(sum, text.charCodeAt(places[j]!) | 0);
  }
  return mix(sum, places.length);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work("a text that is joined " + i + " of several pieces " + i * 3, i % 20, [0, 4, 24, 64][i & 3]!));
console.log(total);
`,
  "a-long-rare-way-changes-the-list-and-reads-it.ts": `// One turn in many takes a long way, which reads the list, cuts it, pushes other elements and reads it again. The other turns read one element each.
${mix}function work(list: number[], n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const e = list[j & 7];
    sum = mix(sum, e === undefined ? -1000 : e);
    if (j === 17) {
      let t = sum | 0;
${longRarePath(k => `list[${k % 8}]!`)}
      list.length = 2;
      list.push(t & 255, 0.5);
      sum = mix(sum, t + list[3]! + list.length);
    }
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work([i, 1, 2, 3, 4, 5, 6, 7], 24));
console.log(total);
`,
  "a-call-that-nearly-never-happens-takes-the-buffer-away.ts": `// A loop adds up a typed array. One turn in thousands calls a function that takes the buffer away, and the turns behind it read undefined.
${mix}function drop(samples: Float64Array): void {
  (samples.buffer as ArrayBuffer).transfer();
}
function work(samples: Float64Array, at: number): number {
  const n = samples.length;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === at) drop(samples);
    const e = samples[j];
    sum += e === undefined ? -1 : e;
  }
  return sum + samples.length;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(new Float64Array(64).fill(i), i % 97 === 41 ? 20 : -1));
console.log(total);
`,
};

/**
 * A program that does not get through a build that checks more. A twin that is always built so is marked as failing. `labels`: where the program itself, which prints the right thing in
 * an ordinary build, is left out; without them only the twin is kept. Whoever mends it takes the call out.
 */
function stopsToday(
  programs: Record<string, string>,
  file: string,
  suffix: string,
  flag: string,
  labels: string[] | undefined,
  today: string,
) {
  const [name, extension] = file.split(/\.(?=[a-z]+$)/);
  programs[`${name}-${suffix}.${extension}`] = programs[file];
  programs[`${name}-${suffix}.json`] =
    JSON.stringify({ build: [flag], skipInVariants: "it has a flag of its own" }, null, 2) + "\n";
  programs[`${name}-${suffix}.todo.txt`] = today + "\n";
  if (labels)
    programs[`${name}.json`] =
      JSON.stringify({ skipInVariant: Object.fromEntries(labels.map(label => [label, `TODO: ${today}`])) }, null, 2) +
      "\n";
  else delete programs[file];
}
