// A closure goes down a chain of calls, and only the last one keeps it, only on a rare path. Each chain is one call longer; each keeper keeps in another way. The closures are called when the frames that made them are long gone.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
type Read = () => string;
const inList: Read[] = [];
let inVariable: Read | null = null;
const inField: { read: Read | null } = { read: null };
const inMap = new Map<number, Read>();
let inClosure: () => string = () => "";
const inBound: Read[] = [];
function keep1(f: Read, i: number): string {
  if (i % 100 === 91) inList.push(f);
  return f();
}
function keep2(f: Read, i: number): string {
  if (i % 100 === 92) inVariable = f;
  return f();
}
function keep3(f: Read, i: number): string {
  if (i % 100 === 93) inField.read = f;
  return f();
}
function keep4(f: Read, i: number): string {
  if (i % 100 === 94) inMap.set(i, f);
  return f();
}
function keep5(f: Read, i: number): string {
  if (i % 100 === 95) inClosure = () => "again " + f();
  return f();
}
function keep6(f: Read, i: number): string {
  if (i % 100 === 96) inBound.push(f.bind(null));
  return f();
}
const down2 = (f: Read, i: number) => keep2(f, i);
const down3a = (f: Read, i: number) => keep3(f, i);
const down3 = (f: Read, i: number) => down3a(f, i);
const down4b = (f: Read, i: number) => keep4(f, i);
const down4a = (f: Read, i: number) => down4b(f, i);
const down4 = (f: Read, i: number) => down4a(f, i);
const down5c = (f: Read, i: number) => keep5(f, i);
const down5b = (f: Read, i: number) => down5c(f, i);
const down5a = (f: Read, i: number) => down5b(f, i);
const down5 = (f: Read, i: number) => down5a(f, i);
const down6d = (f: Read, i: number) => keep6(f, i);
const down6c = (f: Read, i: number) => down6d(f, i);
const down6b = (f: Read, i: number) => down6c(f, i);
const down6a = (f: Read, i: number) => down6b(f, i);
const down6 = (f: Read, i: number) => down6a(f, i);
function work(i: number): number {
  const state = { tag: "state" + i, reads: 0 };
  let local = i;
  const read: Read = () => {
    state.reads++;
    local++;
    return state.tag + "/" + state.reads + "/" + local;
  };
  return keep1(read, i).length + down2(read, i).length + down3(read, i).length + down4(read, i).length + down5(read, i).length + down6(read, i).length;
}
let sum = 0;
for (let i = 0; i < 300; i++) sum += work(i);
console.log(sum, churn(80));
console.log(inList.map(f => f()).join());
console.log(inVariable!(), inField.read!(), [...inMap].map(([i, f]) => i + "=" + f()).join());
console.log(inClosure(), inBound.map(f => f()).join());

// The closure is wrapped on its way down: what is kept is a closure over a closure over the caller's variable.
const wrappers: Read[] = [];
function wrap(f: Read): Read {
  return () => "<" + f() + ">";
}
function wrapAndMaybeKeep(f: Read, i: number): string {
  const wrapped = wrap(wrap(f));
  if (i % 70 === 69) wrappers.push(wrapped);
  return wrapped();
}
function outer(i: number): string {
  let count = 0;
  const text = wrapAndMaybeKeep(() => "n" + i + "." + ++count, i);
  count += 10;
  return text;
}
let lastText = "";
for (let i = 0; i < 200; i++) lastText = outer(i);
console.log(lastText, churn(80), wrappers.map(f => f()).join());

// The closure is handed to a method that an heir overrides; only the heir keeps it.
class Runner {
  run(f: Read): string {
    return f();
  }
}
class KeepingRunner extends Runner {
  kept: Read[] = [];
  run(f: Read): string {
    this.kept.push(f);
    return super.run(f);
  }
}
function runWith(runner: Runner, i: number): string {
  const box = { tag: "box" + i };
  return runner.run(() => box.tag);
}
const plainRunner = new Runner();
const keepingRunner = new KeepingRunner();
let letters = 0;
for (let i = 0; i < 300; i++) letters += runWith(i % 100 === 50 ? keepingRunner : plainRunner, i).length;
console.log(letters, churn(80), keepingRunner.kept.map(f => f()).join());
