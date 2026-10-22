// Built-ins that iterate: plain arrays, maps and sets next to arrays whose iteration or elements run code of the program.
const log = [];
function plain(values) {
  const before = values.length;
  const set = new Set(values);
  return before + set.size + values.length;
}
function withOwnIterator() {
  const values = [1, 2, 3];
  values[Symbol.iterator] = function* () { log.push("own iterator"); values.push(4); yield 9; };
  const before = values.length;
  const set = new Set(values);
  return before * 100 + set.size * 10 + values.length;
}
class Doubled extends Array {
  *[Symbol.iterator]() { log.push("subclass iterator"); for (let i = 0; i < this.length; i++) yield this[i] * 2; }
}
function withSubclass() {
  const values = Doubled.from([1, 2, 3]);
  return [...new Set(values)].join();
}
function withGetter() {
  const values = [1, 2, 3];
  Object.defineProperty(values, 1, { get() { log.push("getter"); values.length = 2; return 7; } });
  const before = values.length;
  const set = new Set(values);
  return before * 100 + set.size * 10 + values.length;
}
function entriesWithGetters() {
  const counter = { reads: 0 };
  const pair = { get 0() { counter.reads++; return "k"; }, get 1() { counter.reads++; return "v"; } };
  const before = counter.reads;
  const map = new Map([pair]);
  return before * 100 + counter.reads * 10 + map.size;
}
function fromCollections() {
  const set = new Set([1, 2, 3]);
  const map = new Map([["a", 1], ["b", 2]]);
  return new Set(set).size + new Map(map).size + Array.from(set).length + Array.from(map.keys()).length + Object.keys(Object.fromEntries(map)).length;
}
function unusedResults(values) {
  new Set(values);
  new Map([[values, values]]);
  return values.length;
}
for (let round = 0; round < 300; round++) {
  const line = [plain([1, 2, 2, 3]), withOwnIterator(), withSubclass(), withGetter(), entriesWithGetters(), fromCollections(), unusedResults([1, 2])].join(" | ");
  if (round === 0 || round === 299) console.log(line, log.length);
}
try { new Set(5); } catch (error) { console.log(error instanceof TypeError); }
try { new Map([1]); } catch (error) { console.log(error instanceof TypeError); }
