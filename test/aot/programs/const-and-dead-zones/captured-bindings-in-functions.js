// A let, const or class of a function that closures capture: reads that come after the declaration, and reads, stores and typeof that come before it and throw.
function attempt(f) { try { return String(f()); } catch (e) { return e.name; } }
function fail() { throw new Error("failed"); }
const published = [];

function counter(start) {
  let count = start;
  const step = () => { count += 1; return count; };
  step();
  return step;
}

function closureBeforeDeclaration() {
  const read = () => value;
  const early = attempt(read);
  let value = 1;
  value = 2;
  return early + " " + attempt(read);
}

function closureOnlyCalledLater() {
  const read = () => value;
  let value = 3;
  value += 1;
  return read();
}

function hoistedReader(callEarly) {
  const early = callEarly ? attempt(read) : "skipped";
  let value = 5;
  function read() { return value++; }
  return early + " " + read() + " " + read();
}

function escapesBeforeDeclaration() {
  published.push(() => value);
  const early = attempt(published[published.length - 1]);
  const value = { n: 6 };
  return early + " " + published[published.length - 1]().n;
}

function storeInDeadZone() {
  const store = () => { value = 7; };
  const early = attempt(store);
  let value = 8;
  store();
  return early + " " + value;
}

function typeofInDeadZone() {
  const ask = () => typeof value;
  const early = attempt(ask);
  let value = 9;
  value++;
  return early + " " + ask();
}

function declarationThatThrows() {
  let read;
  try {
    read = () => value;
    let value = fail();
    value++;
  } catch {}
  return attempt(read);
}

function declarationSkipped(skip) {
  const read = () => value;
  if (skip) return attempt(read);
  let value = 10;
  value++;
  return attempt(read);
}

function classBinding() {
  const make = () => new Box(11);
  const early = attempt(make);
  class Box {
    constructor(n) { this.n = n; }
    again() { return new Box(this.n + 1); }
  }
  return early + " " + make().again().n;
}

function blockInLoop(turns) {
  const readers = [];
  let out = "";
  for (let turn = 0; turn < turns; turn++) {
    const early = () => inBlock;
    out += attempt(early) + " ";
    let inBlock = turn * 2;
    inBlock += 1;
    readers.push(early);
  }
  return out + readers.map(read => read()).join();
}

function loopBindings(turns) {
  const readers = [];
  for (let i = 0; i < turns; i++) readers.push(() => i++);
  return readers.map(read => read() + read()).join();
}

function switchScope(which) {
  let read = () => "none";
  switch (which) {
    case 0:
      let inSwitch = 12;
      inSwitch++;
      read = () => inSwitch;
      break;
    case 1:
      read = () => inSwitch;
      break;
  }
  return attempt(read);
}

class Base { constructor() { this.base = 13; } }
class Derived extends Base {
  constructor(early) {
    const self = () => this.base;
    const before = early ? attempt(self) : "skipped";
    super();
    this.text = before + " " + self();
  }
}

function laterParameter(a = () => b, b = 14) {
  b++;
  return a();
}
function laterParameterReadEarly(a = attempt(() => b), b = 15) {
  b++;
  return a + " " + b;
}

function recursive(depth) {
  let mine = depth;
  const read = () => mine;
  if (depth > 0) recursive(depth - 1);
  mine += 100;
  return read();
}

function* generated() {
  const read = () => value;
  yield attempt(read);
  let value = 16;
  yield read();
  value++;
  yield read();
}

async function awaited() {
  const read = () => value;
  const early = attempt(read);
  await null;
  let value = 17;
  await null;
  value++;
  return early + " " + read();
}

function evaluated() {
  const early = attempt(() => eval("value"));
  let value = 18;
  value++;
  return early + " " + eval("value");
}

function chainOfHoistedFunctions(callEarly) {
  const early = callEarly ? attempt(outer) : "skipped";
  let value = 19;
  value++;
  function outer() { return inner(); }
  function inner() { return value; }
  return early + " " + outer();
}

function declarationLeftByBreak(leave) {
  let read;
  block: {
    read = () => value;
    if (leave) break block;
    let value = 21;
    value++;
  }
  return attempt(read);
}

function innerNameOfClassExpression() {
  const early = [];
  const Outer = class Inner {
    static [(early.push(attempt(() => Inner)), "create")] = () => new Inner();
    static first = Inner.create() instanceof Inner;
  };
  return early[0] + " " + Outer.first + " " + (Outer.create() instanceof Outer);
}

function collectionBeforeDeclaration(size) {
  let list = (Bun.gc(true), new Array(size).fill(size));
  let text = (Bun.gc(true), "n" + size);
  let count = (Bun.gc(true), size * 0.5);
  return () => { list = list.concat(size); text += "."; count += 1; return list.length + text + count; };
}

const step = counter(0);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += step() + counter(i)();
console.log(sum);
console.log(closureBeforeDeclaration(), closureOnlyCalledLater());
console.log(hoistedReader(true), "|", hoistedReader(false));
console.log(escapesBeforeDeclaration(), "|", storeInDeadZone(), "|", typeofInDeadZone());
console.log(declarationThatThrows(), declarationSkipped(true), declarationSkipped(false));
console.log(classBinding(), "|", blockInLoop(3), "|", loopBindings(3));
console.log(switchScope(0), switchScope(1), switchScope(2));
console.log(new Derived(true).text, "|", new Derived(false).text);
console.log(laterParameter(), laterParameterReadEarly(), recursive(3));
console.log([...generated()].join());
console.log(evaluated());
console.log(chainOfHoistedFunctions(true), "|", chainOfHoistedFunctions(false));
console.log(declarationLeftByBreak(true), declarationLeftByBreak(false), innerNameOfClassExpression());
const collected = [collectionBeforeDeclaration(3), collectionBeforeDeclaration(4)];
Bun.gc(true);
console.log(collected[0](), collected[1](), collected[0]());
awaited().then(text => console.log(text));
