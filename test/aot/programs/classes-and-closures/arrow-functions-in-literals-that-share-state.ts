// Members of a literal that are arrow functions over variables of the function that makes the literal: the members of one object share those variables, and no other object sees them. The compiler may put off making such a closure until the member is first read. What a program can find out must not depend on when that is. Each case has a maker of its own, so that no case changes how another is compiled.
// STATISTIC: FieldsDeferringClosures >= 20
// STATISTIC: DeferredClosureSlots >= 20
// IR+ key="summary"[^"]*deferral=CapturesEnvironment
// IR+ key="snapshot"[^"]*deferral=CapturesEnvironment
// IR- key="(both|owner|overCopy|overVariableAndCopy|previous|depth)"[^"]*deferral=Captures
// IR- key="raiseOuter"[^"]*deferral=CapturesEnvironment.*key="raiseInner"[^"]*deferral=CapturesEnvironment
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).name; } }
function describe(value: any): string {
  const parts: string[] = [];
  for (const key in value) parts.push(key + ":" + typeof value[key]);
  return parts.join() + " | " + Reflect.ownKeys(value).length + " | " + JSON.stringify(value);
}

function makeCounter(start: number) {
  let count = start;
  let writes = 0;
  return {
    get: () => count,
    set: (value: number) => { count = value; writes++; },
    add: (left: number, right: number) => { writes++; return (count += left + right); },
    reset: () => { count = 0; writes = 0; },
    history: () => writes,
    summary: () => count + " after " + writes,
  };
}

const unseen = new Function("counter", "action", `
  switch (action) {
  case "call": counter.set(counter.get() + 1); return counter.add(1, 2) + counter.history();
  case "replace": counter.get = () => 100; return counter.get();
  case "number": counter.set = 7; return counter.set;
  case "undefined": counter.add = undefined; return "add" in counter;
  case "delete": return delete counter.reset;
  case "getter": Object.defineProperty(counter, "history", { get() { return () => "from a getter"; }, configurable: true, enumerable: true }); return counter.history();
  case "hidden": Object.defineProperty(counter, "summary", { enumerable: false }); return Object.keys(counter).join();
  case "tag": counter.get.tag = "kept"; return counter.get.tag;
  case "freeze": Object.freeze(counter); return Object.isFrozen(counter);
  case "seal": Object.seal(counter); return Object.isSealed(counter);
  case "names": return Object.getOwnPropertyNames(counter).join() + " " + Object.getOwnPropertySymbols(counter).length + " " + Reflect.ownKeys(counter).length;
  case "take": return [counter.set, counter.get];
  case "key": { const name = ["g", "et"].join(""); return counter[name] === counter.get && counter[name]() === counter.get(); }
  case "orphan": Object.setPrototypeOf(counter, null); counter.set(2); return counter.get() + " " + counter.summary();
  case "prevent": Object.preventExtensions(counter); counter.add(1, 1); return counter.summary() + " " + Object.isExtensible(counter);
  case "grow": for (let n = 0; n < 40; n++) counter["extra" + n] = n; counter.add(1, 2); return counter.summary() + " " + Object.keys(counter).length + " " + Object.keys(counter).slice(0, 7).join();
  }
`);

let sum = 0;
const kept: any[] = [];
for (let n = 0; n < 3000; n++) {
  const counter = makeCounter(n);
  if (n % 200 === 0) {
    kept.push(counter);
    continue;
  }
  counter.set(counter.get() + 1);
  if (n % 7 === 0) sum += counter.add(n, 1);
  sum += counter.get() + counter.history();
}
console.log(sum, kept.length);

const [a, b, c, d, e, f, g, h, i, j, k, l, untouched, other, parent] = kept;
console.log(a.get === a.get, a.get === b.get, a.set === a.set, a.set === b.set, a.get(), b.get(), a.history(), b.summary());
console.log(a.get.name, a.set.name, a.add.length, a.set.length, typeof a.reset, "prototype" in a.get, Object.getPrototypeOf(a.summary) === Function.prototype, a.get.call(null), a.add.apply(null, [2, 3]), a.summary());
console.log(unseen(a, "call"), a.get(), a.history(), unseen(b, "replace"), b.get(), b.summary(), describe(b));
b.set(5);
console.log(b.get(), b.summary(), b.history());
console.log(unseen(c, "number"), c.set, c.add(1, 1), c.get(), c.summary(), describe(c));
console.log(unseen(d, "undefined"), d.add, d.get(), d.set(9), d.summary(), describe(d));
console.log(unseen(e, "delete"), "reset" in e, e.reset, e.set(3), e.get(), e.summary(), describe(e));
e.reset = () => "added again";
console.log(e.reset(), e.summary(), describe(e));
console.log(unseen(f, "getter"), f.history(), f.add(1, 1), f.summary(), describe(f));
console.log(unseen(g, "hidden"), g.summary(), g.reset(), g.summary(), describe(g));
console.log(unseen(h, "tag"), h.get.tag, a.get.tag, h.get(), describe(h));
console.log(unseen(i, "freeze"), i.get(), i.set(-1), i.get(), i.set === i.set, i.summary(), attempt(() => { i.get = null; }), typeof i.get, describe(i));
console.log(unseen(j, "seal"), j.add(2, 2), j.get === j.get, j.summary(), describe(j));
console.log(unseen(k, "names"), k.summary());
const [takenSet, takenGet] = unseen(l, "take");
takenSet(77);
console.log(takenGet(), l.get(), takenGet === l.get, takenSet === l.set, l.summary());
console.log(unseen(makeCounter(30), "key"), unseen(makeCounter(31), "orphan"), unseen(makeCounter(32), "prevent"), unseen(makeCounter(33), "grow"));

const copy = { ...untouched };
const assigned = Object.assign({}, untouched);
copy.set(-5);
console.log(untouched.get(), assigned.get(), copy.get === untouched.get, assigned.add === untouched.add, assigned.summary(), describe(copy));
const cloned = Object.create(Object.getPrototypeOf(other), Object.getOwnPropertyDescriptors(other));
cloned.add(1, 2);
console.log(other.get(), cloned.history === other.history, JSON.stringify(Object.getOwnPropertyDescriptor(other, "get")), typeof Object.getOwnPropertyDescriptor(other, "set")!.value);
const heir = Object.create(parent);
heir.set(1234);
console.log(heir.get(), parent.get(), heir.get === parent.get, Object.keys(heir).length, "get" in heir, Object.hasOwn(heir, "get"), Reflect.get(parent, "summary", heir)());
const seen = new WeakMap<object, string>();
seen.set(untouched.history, "found");
console.log(seen.get(untouched.history), seen.has(other.history));
console.log(Object.entries(makeCounter(8)).map(([key, value]) => key + "=" + (value as Function).name + "/" + (value as Function).length).join(), Object.values(makeCounter(9)).map(value => typeof value).join());
console.log(JSON.stringify(makeCounter(10), (key, value) => (typeof value === "function" ? value.name + value.length : value)), JSON.stringify(Object.fromEntries(Object.entries(makeCounter(11)).map(([key, value]) => [key, typeof value]))));
const proxied = new Proxy(makeCounter(12), {});
proxied.set(13);
console.log(proxied.get(), proxied.get === proxied.get, proxied.summary(), Object.assign(makeCounter(14), { get: () => -1 }).get(), Object.assign(makeCounter(15), { get: () => -1 }).summary());
const source = makeCounter(50);
const wider = { ...source, extra: 1 };
wider.set(51);
console.log(source.get(), wider.get === source.get, wider.extra, Object.keys(source).join(), JSON.stringify(source), "get" in source, source.hasOwnProperty("summary"), describe(wider));
const { get: onlyGet, ...others } = makeCounter(60);
others.set(61);
console.log(onlyGet(), others.summary(), "get" in others, describe(others));

function readThenCall(counter: ReturnType<typeof makeCounter>): number {
  const { get, set } = counter;
  set(get() + 1);
  return counter.get() + (get === counter.get ? 1000 : 0) + counter.history();
}
let read = 0;
for (let n = 0; n < 2000; n++) read += readThenCall(makeCounter(n));
const fresh = makeCounter(0);
[5, 6, 7].forEach(fresh.set);
console.log(read, fresh.summary(), [1, 2].map(fresh.get).join(), [fresh.history, fresh.get].map(each => each()).join());

function makeCell(value: number) {
  let held = value;
  let label = "cell " + value;
  return { read: () => held, write: (next: number) => { held = next; }, name: () => label, rename: (next: string) => { label = next; } };
}
{
  const cells: ReturnType<typeof makeCell>[] = [];
  for (let n = 0; n < 20000; n++) {
    const cell = makeCell(n);
    if (n % 1000 === 0) cells.push(cell);
  }
  collect();
  let passed = 0;
  cells.forEach((cell, index) => { if (cell.read() === index * 1000 && cell.name() === "cell " + index * 1000) passed++; });
  cells.forEach((cell, index) => { cell.write(index); cell.rename("renamed " + index); });
  collect();
  cells.forEach((cell, index) => { if (cell.read() === index && cell.name() === "renamed " + index && cell.read === cell.read) passed++; });
  console.log("collected", passed, cells.length);

  const readers: (() => number)[] = [];
  const writers: ((next: number) => void)[] = [];
  for (let n = 0; n < 20000; n++) {
    const { read, write } = makeCell(n);
    if (n % 1000 === 0) readers.push(read), writers.push(write);
  }
  collect();
  writers.forEach((write, index) => { if (index % 2) write(-index); });
  console.log("taken out", readers.map(read => read()).join());
}

function makeMeter() {
  let level = 1;
  const meter = { level: () => level, raise: () => ++level };
  level = 10;
  const lower = () => --level;
  return { meter, lower };
}
{
  const one = makeMeter(), two = makeMeter();
  console.log("the maker goes on", one.meter.level(), one.meter.raise(), one.lower(), one.lower(), one.meter.level(), two.meter.level(), two.lower(), describe(one.meter));
}

function makeMixed(step: number) {
  let total = 0;
  const mixed = {
    overNothing: () => "nothing",
    overVariable: () => total,
    overItself: () => mixed.overVariable() + 1,
    overVariableAndCopy: () => (total += step),
    overCopy: () => step,
  };
  return mixed;
}
class Factory {
  made = 0;
  make() {
    let local = 0;
    return { count: () => ++local, owner: () => this, both: () => ++this.made + local };
  }
}
interface Link { previous: () => Link | null; depth: () => number }
function makeLink(previous: Link | null): Link {
  return { previous: () => previous, depth: () => (previous ? previous.depth() + 1 : 0) };
}
{
  const head = makeLink(null), middle = makeLink(head), tail = makeLink(middle);
  console.log("over another object of the same kind", tail.previous() === middle, middle.previous() === head, head.previous(), tail.depth(), head.depth(), tail.previous === tail.previous);
  const two = makeMixed(2), three = makeMixed(3);
  console.log("mixed", two.overNothing(), two.overVariableAndCopy(), two.overVariableAndCopy(), three.overVariableAndCopy(), two.overVariable(), two.overItself(), three.overItself(), two.overCopy(), three.overCopy(), two.overNothing === three.overNothing, describe(two));
  const factory = new Factory(), first = factory.make(), second = factory.make();
  console.log("over this", first.count(), first.count(), second.count(), first.both(), second.both(), factory.made, first.owner() === factory, second.owner() === first.owner(), first.owner === second.owner);
}

interface Round { outer: () => number; inner: () => number; both: () => number; raiseOuter: () => number; raiseInner: () => number }
function makeRounds(rounds: number): Round[] {
  let outer = 0;
  const made: Round[] = [];
  for (let round = 0; round < rounds; round++) {
    let inner = round * 10;
    made.push({ outer: () => outer, inner: () => inner, both: () => outer + inner, raiseOuter: () => ++outer, raiseInner: () => ++inner });
  }
  return made;
}
interface Step { index: () => number; skip: () => void }
function makeSteps(): Step[] {
  const made: Step[] = [];
  for (let index = 0; index < 10; index++) {
    const step: Step = { index: () => index, skip: () => { index += 2; } };
    if (index === 2) step.skip();
    made.push(step);
  }
  return made;
}
function keepEveryThird(limit: number) {
  const made: { value: () => number; raise: () => number }[] = [];
  for (let n = 0; n < limit; n++) {
    let value = n;
    const each = { value: () => value, raise: () => ++value };
    if (n % 3 === 0) made.push(each);
    else value += each.raise();
  }
  return made;
}
{
  const rounds = makeRounds(3), others = makeRounds(2);
  console.log("two scopes", rounds[0].raiseOuter(), rounds[1].raiseOuter(), rounds[2].outer(), rounds[1].raiseInner(), rounds.map(round => round.inner()).join(), rounds.map(round => round.both()).join(), others.map(round => round.both()).join());
  const steps = makeSteps();
  steps[0].skip();
  console.log("loop variable", steps.map(step => step.index()).join(), makeSteps().map(step => step.index()).join());
  const thirds = keepEveryThird(3000);
  collect();
  console.log("body of a loop", thirds.length, thirds[1].raise(), thirds[1].value(), thirds[2].value(), thirds[999].value(), thirds.reduce((total, each) => total + each.value(), 0));
}

function makeLate(start: number) {
  const late: { read?: () => number; write?: (next: number) => void } = {};
  {
    let value = start;
    late.read = () => value;
    late.write = next => { value = next; };
  }
  return late;
}
function makeEither(which: boolean) {
  if (which) {
    let left = 1;
    return { read: () => left, raise: () => ++left };
  }
  let right = 100;
  return { read: () => right, raise: () => ++right };
}
function makeSwappable(start: number) {
  let value = start;
  return { peek: () => value, poke: (next: number) => { value = next; } };
}
{
  const late = makeLate(1), later = makeLate(2);
  late.write!(late.read!() + later.read!());
  console.log("variables made after the object", late.read!(), later.read!(), describe(late));
  const left = makeEither(true), right = makeEither(false);
  console.log("either", left.raise(), right.raise(), left.read(), right.read(), makeEither(true).read(), left.read === left.read);
  const first = makeSwappable(1), second = makeSwappable(2);
  first.peek = second.peek;
  second.poke(20);
  first.poke(10);
  console.log("stored by compiled code", first.peek(), second.peek(), first.peek === second.peek, first.poke === second.poke, describe(first));
}

interface Store { load: () => number; save: (value: number) => void }
function makeStore(initial: number): Store { let value = initial; return { load: () => value, save: next => { value = next; } }; }
function makeDoublingStore(initial: number): Store { let value = initial; return { load: () => value * 2, save: next => { value = next; } }; }
function makeStoreFrom(load: () => number, save: (value: number) => void): Store { return { load, save }; }
function exercise(store: Store, value: number): number { const before = store.load(); store.save(value); return before * 1000 + store.load(); }
{
  const plain = makeStore(1), doubling = makeDoublingStore(2), joined = makeStoreFrom(plain.load, doubling.save);
  let exercised = 0;
  for (let n = 0; n < 3000; n++) exercised += exercise(n % 3 === 0 ? plain : n % 3 === 1 ? doubling : joined, n % 5) + exercise(makeStore(n), 1);
  console.log("one type, three makers", exercised, plain.load(), doubling.load(), joined.load(), joined.load === plain.load, joined.save === doubling.save);
}

function makeTally() {
  let tally = 0;
  return { add: (value: number) => { tally += value; }, total: () => tally };
}
function sumWithTally(limit: number): number {
  const tally = makeTally();
  for (let n = 0; n < limit; n++) tally.add(n);
  return tally.total();
}
function sumWithLocalLiteral(limit: number): number {
  let total = 0;
  const local = { add: (value: number) => { total += value; }, total: () => total };
  for (let n = 0; n < limit; n++) local.add(n);
  return local.total() + total;
}
{
  let tallied = 0;
  for (let n = 0; n < 3000; n++) tallied += sumWithTally(n % 10) + sumWithLocalLiteral(n % 7);
  console.log("never leaves the function", tallied);
}

function makeKinds() {
  let ticks = 0;
  return {
    arrow: () => ++ticks,
    asyncArrow: async () => { await null; return ++ticks; },
    expression: function () { return ++ticks; },
    generator: function* () { while (ticks < 8) yield ++ticks; },
    method() { return ++ticks; },
    get current() { return ticks; },
    set current(value: number) { ticks = value; },
  };
}
for (const kinds of [makeKinds(), makeKinds()]) {
  console.log("kinds", kinds.arrow(), await kinds.asyncArrow(), kinds.expression(), kinds.method(), kinds.current, [...kinds.generator()].join(), (kinds.current = 50), kinds.arrow(), typeof new (kinds.expression as any)(), kinds.current, kinds.expression.prototype.constructor === kinds.expression, describe(kinds));
}

function makeEarly(start: number) {
  const early = { read: () => later, write: (value: number) => { later = value; } };
  const before = attempt(early.read) + " " + attempt(() => early.write(1));
  let later = start;
  return { early, before };
}
function makeInOrder() {
  let n = 0;
  const made = { before: () => n, first: n++, between: () => n, second: n++, after: () => ++n };
  n += 10;
  return made;
}
interface TreeNode { value: () => number; raise: () => number; child: TreeNode | null }
function makeTree(depth: number): TreeNode {
  let count = depth;
  return { value: () => count, raise: () => ++count, child: depth > 0 ? makeTree(depth - 1) : null };
}
function makeGuarded(limit: number) {
  let used = 0;
  let ceiling = limit;
  return {
    use: () => { if (used >= ceiling) throw new RangeError("used up after " + used); return ++used; },
    used: () => used,
    allow: (more: number) => { ceiling += more; },
  };
}
{
  const five = makeEarly(5), six = makeEarly(6);
  five.early.write(five.early.read() + six.early.read());
  console.log("before the declaration", five.before, five.early.read(), six.early.read());
  const ordered = makeInOrder();
  console.log("in order", ordered.first, ordered.second, ordered.before(), ordered.after(), ordered.between(), makeInOrder().between(), describe(ordered));
  const tree = makeTree(3);
  tree.child!.raise();
  tree.child!.child!.child!.raise();
  const values: number[] = [];
  for (let node: TreeNode | null = tree; node; node = node.child) values.push(node.value());
  console.log("a call between the members", values.join(), makeTree(1).child!.value());
  const guarded = makeGuarded(2), unused = makeGuarded(0);
  console.log("throws", guarded.use(), guarded.use(), attempt(guarded.use), guarded.used(), guarded.allow(1), guarded.use(), attempt(guarded.use), attempt(unused.use), unused.used());
}

function makeAmount(start: number) {
  let amount = start;
  return { valueOf: () => amount, toString: () => "amount " + amount, toJSON: () => ({ amount }), double: () => { amount *= 2; } };
}
function makeThenable(start: number) {
  let settled = start;
  return { then: (resolve: (value: number) => void) => { resolve(settled++); }, settled: () => settled };
}
function makeCountdown(from: number) {
  let left = from;
  const countdown = {
    next: () => (left > 0 ? { done: false, value: left-- } : { done: true, value: 0 }),
    refill: (to: number) => { left = to; },
    [Symbol.iterator]: () => countdown,
  };
  return countdown;
}
{
  const amount = makeAmount(21), smaller = makeAmount(1);
  amount.double();
  console.log("read by conversions", +amount, `${amount}`, (amount as any) + 1, (amount as any) > 41, JSON.stringify(amount), JSON.stringify([smaller, amount]), String(smaller), [amount, smaller].join());
  const thenable = makeThenable(3);
  console.log("read by await", await thenable, await thenable, thenable.settled(), await Promise.resolve(makeThenable(8)), (await Promise.all([makeThenable(1), makeThenable(2)])).join());
  const countdown = makeCountdown(3), counted: number[] = [];
  for (const left of countdown) counted.push(left);
  countdown.refill(2);
  console.log("read by iteration", counted.join(), [...countdown].join(), [...countdown].length, [...makeCountdown(4)].join(), Reflect.ownKeys(countdown).length);
}

function makeList(name: string) {
  let title = name;
  let items: number[] = [];
  let version = 0;
  return {
    title: () => title,
    rename: (next: string) => { title = next; version++; },
    push: (item: number) => { version++; return items.push(item); },
    pop: () => { version++; return items.pop(); },
    size: () => items.length,
    clear: () => { items = []; version++; },
    first: () => items[0],
    last: () => items[items.length - 1],
    total: () => items.reduce((total, item) => total + item, 0),
    has: (item: number) => items.includes(item),
    list: () => items.join(),
    version: () => version,
    snapshot: () => ({ title, size: items.length, version }),
    isEmpty: () => items.length === 0,
    reverse: () => { items.reverse(); version++; },
    restore: (saved: { title: string; version: number }) => { title = saved.title; version = saved.version; },
  };
}
{
  let pushed = 0;
  const lists: ReturnType<typeof makeList>[] = [];
  for (let n = 0; n < 3000; n++) {
    const list = makeList("list " + n);
    pushed += list.push(n) + list.push(n + 1);
    if (n % 1000 === 0) lists.push(list);
  }
  collect();
  const [zero, thousand, unread] = lists;
  const saved = zero.snapshot();
  zero.rename("renamed");
  zero.reverse();
  console.log("many members", pushed, zero.title(), zero.list(), zero.first(), zero.last(), zero.total(), zero.has(1), zero.has(2), zero.version(), JSON.stringify(saved), JSON.stringify(zero.snapshot()));
  zero.restore(saved);
  zero.clear();
  console.log(zero.title(), zero.version(), zero.isEmpty(), zero.size(), zero.pop(), thousand.pop(), thousand.list(), thousand.title(), thousand.isEmpty());
  console.log(Object.keys(unread).join(), Object.keys(unread).filter(key => (unread as any)[key].length === 0 && key !== "clear" && key !== "pop" && key !== "reverse").map(key => String((unread as any)[key]())).join("; "));
}

class Account {
  deposit: (amount: number) => number;
  balance: () => number;
  constructor(opening: number) {
    let held = opening;
    this.deposit = amount => (held += amount);
    this.balance = () => held;
  }
}
class Unrelated { balance = () => -1; extra = "extra"; }
function Other() {}
class Wallet {
  spend: (amount: number) => number;
  left: () => number;
  constructor(opening: number) {
    let held = opening;
    this.spend = amount => (held -= amount);
    this.left = () => held;
  }
}
class SharedWallet extends Wallet { owners = 2; share = () => this.left() / this.owners; }
{
  let balances = 0;
  const accounts: Account[] = [];
  for (let n = 0; n < 2000; n++) {
    const account = new Account(n);
    if (n % 500 === 0) {
      accounts.push(account);
      continue;
    }
    balances += account.deposit(1) + account.balance();
  }
  collect();
  console.log("constructors", balances, accounts.map(account => account.deposit(1) + account.balance()).join(), accounts[0].balance === accounts[0].balance, accounts[0].balance === accounts[1].balance, describe(accounts[2]));
  const underFunction = Reflect.construct(Account, [5], Other) as Account;
  const underClass = Reflect.construct(Account, [7], Unrelated) as Account;
  console.log(underFunction.deposit(1), underFunction.balance(), underFunction instanceof Account, Object.getPrototypeOf(underFunction) === Other.prototype, describe(underFunction));
  console.log(underClass.deposit(1), underClass.balance(), underClass instanceof Unrelated, "extra" in underClass, new Unrelated().balance(), describe(underClass));
  const wallet = new Wallet(10), shared = new SharedWallet(20), alsoShared = new SharedWallet(30);
  console.log(wallet.spend(1), shared.spend(2), shared.share(), alsoShared.share(), wallet.left(), shared.left === shared.left, shared.left === alsoShared.left, describe(shared));
  const underSubclass = Reflect.construct(Wallet, [40], SharedWallet) as SharedWallet;
  console.log(underSubclass.spend(4), underSubclass.left(), underSubclass instanceof SharedWallet, "owners" in underSubclass, underSubclass.left === underSubclass.left, describe(underSubclass));
}

async function makeLater(start: number) {
  let value = start;
  await null;
  const made = { read: () => value, write: (next: number) => { value = next; } };
  await null;
  value++;
  return made;
}
function* makeShared() {
  let shared = 0;
  while (true) yield { read: () => shared, raise: () => ++shared };
}
{
  const [one, ten] = await Promise.all([makeLater(1), makeLater(10)]);
  one.write(one.read() + ten.read());
  console.log("made by an async function", one.read(), ten.read());
  const [first, second] = makeShared();
  const [apart] = makeShared();
  console.log("made by a generator", first.raise(), second.raise(), first.read(), apart.read(), first.read === second.read);
}

{
  let once = 0;
  const single = { read: () => once, raise: () => ++once };
  once = 5;
  console.log("made once", single.raise(), single.read(), once, single.read === single.read, describe(single));
}
export {};
