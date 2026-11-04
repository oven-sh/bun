// What the names of the parameters of a suspended function hold, asked while the function is suspended.
let last;
let sink = 0;
function watched(value) {
  last = new WeakRef(value);
  return value;
}
function make(n) {
  return watched({ n });
}
function plain(n) {
  return { n };
}
function use(value) {
  sink += value.n;
}
async function ask(label) {
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
  }
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  return 1;
}

async function defaultTaken(n, p = make(n)) {
  use(p);
  await ask("a default that was taken, named only in front");
}
await defaultTaken(1);
async function defaultTakenNeverNamed(n, p = make(n)) {
  await ask("a default that was taken, never named");
}
await defaultTakenNeverNamed(1);
async function defaultNotTaken(n, p = plain(n)) {
  use(p);
  await ask("an argument in the place of a default, named only in front");
}
await defaultNotTaken(1, make(2));
async function firstValue(p, n) {
  use(p);
  p = plain(n);
  use(p);
  await ask("the argument of a parameter that was stored to");
}
await firstValue(make(1), 2);
async function storedValue(p, n) {
  use(p);
  p = make(n);
  use(p);
  await ask("what was stored to a parameter, named only in front");
}
await storedValue(plain(1), 2);
async function storedOnOnePath(p, n) {
  if (n > 1) p = make(n);
  use(p);
  await ask("what was stored to a parameter on one path");
}
await storedOnOnePath(plain(1), 2);
async function storedBetween(p, n) {
  await ask("the argument of a parameter that is stored to behind the await");
  p = plain(n);
  use(p);
  await ask("the same behind the store");
}
await storedBetween(make(1), 2);
async function storedInALoop(p, n) {
  for (let i = 0; i < n; i++) {
    p = i === 1 ? make(i) : plain(i);
    use(p);
    await ask("what a turn of a loop stored to a parameter, turn " + i);
  }
}
watched({});
await storedInALoop(plain(1), 3);
async function source({ inner }) {
  await ask("the source of a destructured parameter");
  return inner;
}
await source(watched({ inner: 1 }));
async function sourceWithDefault({ inner } = watched({ inner: 1 })) {
  await ask("a default that is the source of a destructured parameter");
  return inner;
}
await sourceWithDefault();
async function member({ inner }) {
  use(inner);
  await ask("a name of a destructured parameter, named only in front");
}
await member({ inner: make(1) });
async function memberNeverNamed({ inner }) {
  await ask("a name of a destructured parameter, never named");
}
await memberNeverNamed({ inner: make(1) });
async function memberTakenOut(holder) {
  const { inner } = holder;
  use(inner);
  holder.inner = undefined;
  await ask("a local taken out of a parameter, named only in front");
}
await memberTakenOut({ inner: make(1) });
async function memberRemovedFromSource({ inner }, holder) {
  holder.inner = undefined;
  await ask("a name of a destructured parameter whose source has lost the member");
}
async function asks1() {
  const holder = { inner: make(1) };
  await memberRemovedFromSource(holder, holder);
}
await asks1();
async function nested({ outer: { inner } }) {
  await ask("a name two levels down in a destructured parameter");
}
await nested({ outer: { inner: make(1) } });
async function middleOfNested({ outer: { inner } }) {
  await ask("the object between the source and the name");
}
await middleOfNested({ outer: watched({ inner: 1 }) });
async function element([first]) {
  await ask("an element of a destructured list");
}
await element([make(1)]);
async function others({ a, ...rest }) {
  await ask("a member of the rest of a destructured parameter");
}
await others({ a: 1, b: make(1) });
async function memberDefault({ inner = make(1) }) {
  await ask("a default of a name of a destructured parameter");
}
await memberDefault({});
async function rest(...list) {
  sink += list.length;
  await ask("a member of a rest parameter");
}
await rest(make(1));
const arrow = async ({ inner }) => {
  await ask("a name of a destructured parameter of an arrow function");
};
await arrow({ inner: make(1) });
const arrowSource = async ({ inner }) => {
  await ask("the source of a destructured parameter of an arrow function");
};
await arrowSource(watched({ inner: 1 }));
async function shared(p, n) {
  const store = () => {
    p = plain(n);
  };
  store();
  await ask("the argument of a parameter that a closure stored to");
  return store;
}
await shared(make(1), 2);
async function sharedStored(p, n) {
  const store = () => {
    p = make(n);
  };
  store();
  await ask("what a closure stored to a parameter");
}
await sharedStored(plain(1), 2);
async function listed(p) {
  sink += arguments.length;
  await ask("an argument beyond the parameters of a function that names `arguments`");
}
await listed(1, make(1));
async function unlisted(p) {
  await ask("an argument beyond the parameters");
}
await unlisted(1, make(1));
class Holder {
  async method({ inner }, p = make(2)) {
    await ask("a default of a method");
  }
}
await new Holder().method({ inner: 1 });

function* notStarted({ inner }) {
  yield 1;
}
async function asks2() {
  const it = notStarted({ inner: make(1) });
  await ask("generator that has not started: a name of a destructured parameter");
  it.next();
}
await asks2();
async function asks3() {
  const it = notStarted(watched({ inner: 1 }));
  await ask("generator that has not started: the source of a destructured parameter");
  it.next();
}
await asks3();
function* started({ inner }, p = make(1)) {
  yield 1;
  yield 2;
}
async function asks4() {
  const it = started({ inner: 1 });
  it.next();
  await ask("generator at its first yield: a default that was taken");
  it.next();
}
await asks4();
function* storesTo(p, n) {
  p = plain(n);
  yield 1;
  yield 2;
}
async function asks5() {
  const it = storesTo(make(1), 2);
  it.next();
  await ask("generator at its first yield: the argument of a parameter that was stored to");
  it.next();
}
await asks5();
async function* asyncGenerator({ inner }, p = make(1)) {
  yield 1;
  await ask("async generator: a default that was taken");
  yield 2;
}
for await (const step of asyncGenerator({ inner: 1 })) sink += step;
async function* few() {
  yield 1;
}
async function iterates({ inner }) {
  for await (const step of few()) await ask("in a for await: a name of a destructured parameter");
}
await iterates({ inner: make(1) });
async function waitsInStep(p = make(1)) {
  async function* slow() {
    await ask("while a for await waits for its step: a default that was taken");
    yield 1;
  }
  for await (const step of slow()) sink += step;
}
await waitsInStep();
