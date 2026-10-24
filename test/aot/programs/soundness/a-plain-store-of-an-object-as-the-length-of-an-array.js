// A plain store under `length` of an array makes a number of what is stored: `valueOf`, `toString` or `Symbol.toPrimitive` of a stored object runs, twice for each store. soundness/a-counter-is-stale-after-a-built-in-stores-an-object-as-the-length-of-an-array.js has the built-ins that store.
let calls = 0;
const length = { valueOf() { calls++; return 3; } };
const list = [];
list.length = length;
console.log(list.length, calls);
list["len" + "gth"] = length;
console.log(list.length, calls);
console.log((list.length = length) === length, list.length, calls);

function storeUnder(target, key, value) { target[key] = value; return target.length; }
for (const key of ["length", "size", 0]) console.log(String(key), storeUnder([], key, length), calls);

class L extends Array {}
const heir = new L();
heir.length = length;
console.log(heir.length, calls);
heir["len" + "gth"] = length;
console.log(heir.length, calls, heir instanceof L);
console.log(storeUnder(new L(), "length", length), calls);

const text = {};
text.toString = function () { calls++; return "2"; };
list.length = text;
console.log(list.length, calls);
heir.length = text;
console.log(heir.length, calls);

class Count {
  constructor(n) { this.n = n; }
  valueOf() { calls++; return this.n; }
}
list.length = new Count(5);
console.log(list.length, calls);

const hinted = { [Symbol.toPrimitive](hint) { calls++; return hint === "number" ? 4 : 40; } };
list.length = hinted;
console.log(list.length, calls);

function dropTheArray() {
  const quiet = { valueOf() { console.log("valueOf runs"); return 1; } };
  [].length = quiet;
}
dropTheArray();

function dropTheHeir() {
  const late = {};
  late.toString = function () { console.log("toString runs"); return "1"; };
  new L().length = late;
}
dropTheHeir();

function setLength(target, value) { target.length = value; return target.length; }
const record = { length: 0 };
console.log(setLength(record, length) === length, calls);
console.log(setLength([1, 2, 3, 4], length), calls);
let sum = 0;
for (let i = 0; i < 300; i++) sum += i % 3 === 0 ? setLength([], length) : i % 3 === 1 ? setLength(new L(), text) : Number(setLength({}, length) === length);
console.log(sum, calls);

class Failure {
  constructor(why) { this.why = why; }
}
const failing = { valueOf() { throw new Failure("thrown by valueOf"); } };
try { list.length = failing; } catch (error) { console.log(error.why, error instanceof Failure, list.length); }
try { heir["len" + "gth"] = failing; } catch (error) { console.log(error.why, error instanceof Failure, heir.length); }

const changing = { valueOf() { return ++calls; } };
try { list.length = changing; } catch (error) { console.log(error instanceof RangeError, list.length, calls); }
const fraction = { valueOf() { calls++; return 1.5; } };
try { list.length = fraction; } catch (error) { console.log(error instanceof RangeError, list.length, calls); }
const neither = { valueOf() { calls++; return {}; }, toString() { calls++; return []; } };
try { list.length = neither; } catch (error) { console.log(error instanceof TypeError, list.length, calls); }
