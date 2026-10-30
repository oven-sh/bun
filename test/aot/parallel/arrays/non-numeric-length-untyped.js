// `new Array(n)` and `Array(n)` where the text does not say that n is a number, as Express's restore() has it with `arguments.length - 2`: what is made, and that filling it does not ask the run time.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
// Env: JSC_aotCountsPath=/dev/null
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named, and but for the calls that found an allocator without a cell at hand and filled it again: a line "<calls>\trefilled:<name>".
// How often that is goes by the size of the cells, which is not the same on every machine.
function callsIn(counts, ...besides) {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
    const [refills, refilled] = line.split("\trefilled:");
    if (refilled !== undefined && !besides.includes(refilled)) sum -= Number(refills);
  }
  return sum;
}
// These make the text that is printed and keep it in a set; a cell or an array where the allocator has none at hand is the work of the run time.
const owed = ["operationAOTArrayJoin", "operationAOTConcat", "operationAOTStackStringBuilderAppend", "operationAOTStackStringBuilderFinish", "operationAOTSetAdd", "operationAOTAllocateSlow", "operationAOTNewArrayOfHoles"];
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
// A method that is looked up under a name put together, and that has no loop of its own, so that no loop of the text is near it: a server's handlers are such functions.
const router = { restore(holder, object) {
  var props = new Array(holder.count - 2);
  var values = Array(holder.count - 2);
  if (props.length > 0) { props[0] = holder[2]; values[0] = object[props[0]]; }
  if (props.length > 1) { props[1] = holder[3]; values[1] = object[props[1]]; }
  if (props.length > 2) { props[2] = holder[4]; values[2] = object[props[2]]; }
  return props.join() + "=" + values.join();
} };
const nameOfMethod = ["re", "store"].join("");
const restore = (holder, object) => router[nameOfMethod](holder, object);
const request = { baseUrl: "/", next: 1, params: "p" };
const seen = new Set();
let before = countsSoFar();
for (let i = 0; i < 2000; i++)
  seen.add(restore({ count: 5, 2: "baseUrl", 3: "next", 4: "params" }, request) + " " + restore({ count: 2 }, request) + " " + restore({ count: 3, 2: "next" }, request));
let calls = callsIn(countsSoFar(), ...owed) - callsIn(before, ...owed);
console.log([...seen].join(" | "), calls <= 8 ? "and the run time was asked at most 8 times" : "and the run time was asked " + calls + " times");

// What is handed over decides what is made.
const describe = (array) => Array.isArray(array) + " " + array.length + " " + Object.keys(array).join() + " " + JSON.stringify(array) + " " + (Object.getPrototypeOf(array) === Array.prototype);
const given = [0, 1, 2, 7, 100, 1000, 100000, 4294967295, -1, -0, 1.5, NaN, Infinity, 4294967296, "3", "", null, undefined, true, {}, [5], 3n, Symbol.iterator, () => 1];
for (const value of given) {
  const show = (array) => array.length > 10 ? "long " + array.length + " " + (0 in array) : describe(array.map ? array.map((element) => typeof element === "symbol" || typeof element === "bigint" || typeof element === "function" ? typeof element : element) : array);
  console.log(typeof value, attempt(() => show(new Array(value))), "|", attempt(() => show(Array(value))));
}

// Holes are holes: nothing is there, and the length counts them.
function holes(n) {
  const array = new Array(n);
  return [array.length, 0 in array, array[0], array.indexOf(undefined), array.includes(undefined), array.join("-"), Object.keys(array).length].join();
}
console.log(holes(3), holes(0), holes(1));

// Numbers, strings and objects stored afterwards, beyond the end too.
for (let i = 0; i < 4; i++) {
  const array = new Array(request.next + i);
  array[0] = i;
  array[i] = "s" + i;
  array[i + 3] = { i };
  array.push(1.5);
  console.log(JSON.stringify(array), array.length);
}

// An heir of Array.prototype with an index of its own stands between: a hole lets it shine through, a store to the hole meets its setter.
const stored = [];
const between = Object.create(Array.prototype, { 1: { value: "from the heir", configurable: true }, 2: { set(value) { stored.push(value); }, get() { return "got"; }, configurable: true } });
const watched = new Array(request.next + 3);
Object.setPrototypeOf(watched, between);
watched[2] = "to the setter";
watched[0] = "own";
console.log(stored.join(), watched[1], watched[2], 2 in watched, Object.keys(watched).join(), watched.length);
console.log(describe(new Array(request.next + 1)));
