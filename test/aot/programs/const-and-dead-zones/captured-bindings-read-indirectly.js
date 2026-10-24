// A captured let, const or class that is read by a way other than a plain call of the closure: a getter, a proxy trap, a generator, a bound function, a comparator, a closure that another function creates.
function attempt(f) { try { return String(f()); } catch (e) { return e.name; } }

function readByGetter() {
  const holder = { get now() { return value; } };
  const early = attempt(() => holder.now);
  let value = 23;
  value++;
  return early + " " + holder.now;
}

function readByProxyTrap() {
  const proxy = new Proxy({}, { get: () => value });
  const early = attempt(() => proxy.anything);
  let value = 25;
  value++;
  return early + " " + proxy.anything;
}

function generatorResumedByInitializer() {
  function* reader() { yield attempt(() => value); yield attempt(() => value); }
  const iterator = reader();
  let value = iterator.next().value === "ReferenceError" ? 27 : -1;
  value++;
  return value + " " + iterator.next().value;
}

function outerClassBindingInStaticField() {
  let inner;
  class Late {
    static { inner = () => Late; }
    static early = attempt(() => readOuter());
    static innerEarly = inner() === Late;
  }
  function readOuter() { return Late; }
  return Late.early + " " + Late.innerEarly + " " + (readOuter() === Late);
}

function continueOverDeclaration(turns) {
  let out = "";
  let previous = () => "none";
  outer: for (let turn = 0; turn < turns; turn++) {
    const read = () => inBody;
    out += attempt(read) + ",";
    if (turn % 2) { previous = read; continue outer; }
    let inBody = turn + 30;
    inBody++;
    out += read() + ";";
  }
  return out + attempt(previous);
}

function readerCreatedByHoistedFunction(callEarly) {
  function make() { return () => value; }
  const early = callEarly ? attempt(make()) : "skipped";
  let value = 33;
  value++;
  return early + " " + make()();
}

function readerCreatedTwoLevelsDown(callEarly) {
  function outer() { return function middle() { return () => value; }; }
  const early = callEarly ? attempt(outer()()) : "skipped";
  let value = 35;
  value++;
  return early + " " + outer()()();
}

function storedThroughArray(callEarly) {
  const table = [() => value];
  const early = callEarly ? attempt(table[0]) : "skipped";
  let value = 37;
  value++;
  return early + " " + table[0]();
}

function calledByInitializer() {
  const read = () => value;
  let value = attempt(read) + "!";
  value += "?";
  return value + " " + read();
}

function boundReader(callEarly) {
  const read = function () { return value + this.more; }.bind({ more: 1 });
  const early = callEarly ? attempt(read) : "skipped";
  let value = 39;
  value++;
  return early + " " + read();
}

function reusedScope(turns) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    let inBody = turn * 1.5;
    const add = () => { inBody += 0.5; return inBody; };
    total += add() + add();
  }
  return total;
}

function sortedDuringInitializer() {
  const order = [];
  const compare = (a, b) => { order.push(attempt(() => limit)); return a - b; };
  const limit = [3, 1, 2].sort(compare).length;
  return order.every(entry => entry === "ReferenceError") + " " + limit + " " + attempt(() => limit);
}

console.log(readByGetter(), "|", readByProxyTrap(), "|", generatorResumedByInitializer());
console.log(outerClassBindingInStaticField(), "|", continueOverDeclaration(4));
console.log(readerCreatedByHoistedFunction(true), "|", readerCreatedByHoistedFunction(false));
console.log(readerCreatedTwoLevelsDown(true), "|", readerCreatedTwoLevelsDown(false));
console.log(storedThroughArray(true), "|", storedThroughArray(false), "|", calledByInitializer());
console.log(boundReader(true), "|", boundReader(false), "|", reusedScope(1000), "|", sortedDuringInitializer());
