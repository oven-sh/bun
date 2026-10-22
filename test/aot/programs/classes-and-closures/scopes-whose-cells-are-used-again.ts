// The cell that holds the variables of a call is used again by the next call, unless somebody has kept a function that sees those variables.
// Built without inlining, so that the inner functions stay calls and the scope stays a cell.
type Kept = () => string;
const keptFunctions: Kept[] = [];

function work(n: number, keeps: boolean): number {
  let sum = 0;
  let label = "w" + n;
  add(n);
  if (keeps) keep();
  add(1);
  return sum;

  function add(k: number): void {
    sum += k > 2 ? (add(k - 2), 2) : k;
  }
  function keep(): void {
    keptFunctions.push(() => label + ":" + sum);
  }
}
let total = 0;
for (let i = 0; i < 5000; i++) total += work(i % 9, i % 1000 === 7);
console.log(total, keptFunctions.map(f => f()).join());

// A call inside a call: the outer scope is still in use while the inner calls come and go.
function nested(depth: number, tag: string): string {
  let text = tag;
  append("<");
  if (depth > 0) append(nested(depth - 1, tag + depth));
  if (depth > 1) append(nested(depth - 2, tag + "x"));
  append(">");
  return text;

  function append(part: string): void {
    text += part.length > 40 ? (append(part.slice(0, 3)), "~") : part;
  }
}
console.log(nested(4, "n"));

// The function throws out of the middle, and the next call starts from fresh variables.
function mayThrow(n: number): number {
  let seen = 0;
  let list: number[] | undefined;
  step(n);
  return seen + (list ? list.length : 0);

  function step(k: number): void {
    seen++;
    if (k === 3) throw new Error("three after " + seen);
    if (k > 0) step(k - 2);
    else list = [k];
  }
}
const outcomes: string[] = [];
for (let i = 0; i < 8; i++) {
  try {
    outcomes.push(String(mayThrow(i)));
  } catch (error) {
    outcomes.push((error as Error).message);
  }
}
console.log(outcomes.join());

// A variable that this call never assigns must not show what the last call left in the cell.
function leavesSomeUnset(sets: boolean): string {
  let maybe: string | undefined;
  let count = 0;
  if (sets) assign();
  bump();
  return String(maybe) + count;

  function assign(): void {
    maybe = "set" + (count > 5 ? (bump(), "") : "");
  }
  function bump(): void {
    count += count > 100 ? (bump(), 0) : 1;
  }
}
console.log(leavesSomeUnset(true), leavesSomeUnset(false), leavesSomeUnset(true), leavesSomeUnset(false));

// Kept by a generator, by an async function that is waiting, and by a function that is kept only now and then; with collections in between.
function* yields(n: number) {
  let at = n;
  while (at < n + 2) yield next();
  function next(): number {
    return (at += at > 1000 ? (next(), 0) : 1);
  }
}
async function waits(n: number): Promise<number> {
  let acc = n;
  grow();
  await null;
  grow();
  return acc;
  function grow(): void {
    acc += acc > 1000 ? (grow(), 0) : 10;
  }
}
const generators = [yields(1), yields(10), yields(100)];
const firsts = generators.map(g => g.next().value);
const promises = [waits(1), waits(2), waits(3)];
for (let i = 0; i < 300; i++) {
  work(i % 5, false);
  if (i % 100 === 0) Bun.gc(true);
}
console.log(firsts.join(), generators.map(g => g.next().value).join(), (await Promise.all(promises)).join(), keptFunctions.map(f => f()).join());
