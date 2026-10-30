// Calls of built-in functions whose operands say more than their types: a target that was made on the spot, a needle that is a constant. The same call stands at several places, far from any loop.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
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
// These make the text that is printed, count the names for it and keep it in a set; a cell where the allocator has none at hand is the work of the run time.
const owed = ["operationAOTConcat", "operationAOTConcatenate", "operationAOTToString", "operationAOTOwnPropertyKeys", "operationAOTSetAdd", "operationAOTAllocateSlow", "operationAOTNewDictionary"];
const first = (source) => Object.assign({}, source);
const second = (source) => Object.assign({}, source);
const third = (source) => Object.assign({}, source);
const withMore = (source, more) => Object.assign({}, source, more);
const alsoWithMore = (source, more) => Object.assign({}, source, more);
const intoGiven = (target, source) => Object.assign(target, source);
const alsoIntoGiven = (target, source) => Object.assign(target, source);
const pathOf = (url) => url.slice(url.indexOf("/", 8));
const alsoPathOf = (url) => url.slice(url.indexOf("/", 8));
const queryOf = (url) => url.indexOf("?", 8);
const alsoQueryOf = (url) => url.indexOf("?", 8);
const partsOf = (text) => text.split(",");
const alsoPartsOf = (text) => text.split(",");
const isSecure = (url) => url.startsWith("https:");
const alsoIsSecure = (url) => url.startsWith("https:");
const call = (f, ...given) => f(...given);
const source = JSON.parse('{"a":1,"b":"two","c":[3],"d":{"e":4}}');
let seen = 0;
const withGetter = { get a() { seen++; return "got"; }, b: 2 };
const show = (value) => JSON.stringify(value) + " " + Object.keys(value).length;
const before = count("operationAOTCopyDataProperties");
const said = new Set();
let known = "";
for (let i = 0; i < 300; i++) {
  if (i === 30) known = countsSoFar();
  for (const f of [first, second, third]) {
    const copy = call(f, source);
    said.add(show(copy) + (copy !== source) + (copy.c === source.c));
  }
}
const calls = count("operationAOTCopyDataProperties") - before + callsIn(countsSoFar(), ...owed) - callsIn(known, ...owed);
console.log([...said].join(" | "), calls === 0 ? "and each copy was made in one step" : "and " + calls + " copies were made property by property");
console.log(show(call(first, withGetter)), seen, show(call(second, null)), show(call(third, "ab")), show(call(first, [7, 8])), show(call(second, 5)));
console.log(show(call(withMore, source, { a: 9, z: 0 })), show(call(alsoWithMore, { z: 0 }, source)), show(call(withMore, undefined, source)));
const given = { kept: true };
console.log(call(intoGiven, given, source) === given, show(given), show(call(alsoIntoGiven, { a: 0 }, withGetter)), seen);
const frozen = Object.freeze({ a: 0 });
let thrown = "nothing";
try { call(intoGiven, frozen, source); } catch (error) { thrown = error.constructor.name; }
console.log(thrown);
const searchesBefore = count("operationAOTStringFind8");
for (const url of ["http://localhost/user", "https://example.com/a/b?c=d", "http://nothing", "http://é€.example/€?x"]) {
  console.log(call(pathOf, url), call(alsoPathOf, url), call(queryOf, url), call(alsoQueryOf, url), call(isSecure, url), call(alsoIsSecure, url));
}
const searches = count("operationAOTStringFind8") - searchesBefore;
console.log(searches === 0 ? "a needle of one character was looked for as a character" : searches + " needles of one character were looked for as strings");
console.log(call(partsOf, "a,b,,c").length, call(alsoPartsOf, "").length, call(partsOf, "no comma").join("|"), call(alsoPartsOf, ",").length);
