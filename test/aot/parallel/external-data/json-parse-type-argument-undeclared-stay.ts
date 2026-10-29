// An object with undeclared keys, or with its keys in another order, is made by the compiled parser at once: no plain object is made and converted, and the text is not read again.
// IR+ ^ .* = JSONParseExtraMembers v[0-9]+, v[0-9]+, v[0-9]+ layout=L[0-9]+
// IR+ ^ .* = JSONObjectFinish v[0-9]+, v[0-9]+, v[0-9]+ layout=L[0-9]+
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
declare const aotRuntimeCounters: undefined | (() => string);
interface Point { x: number; y: number; label?: string }
interface Segment { id: number; from: Point; to: Point; tags: string[] }

const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const count = (name: string) => (counted ? counted(name) : 0);
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = (): string => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text that are not the compiled parser's own.
function callsOutsideTheParser(counts: string): number {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !name.startsWith("operationAOTJSON")) sum += Number(calls);
  }
  return sum;
}
function measure(what: string, texts: string[], readAgainExpected: number, callsForUndeclaredKeys: number): void {
  for (let i = 0; i < 8; i++) for (const text of texts) (JSON.parse(text) as Segment);
  const [before, readAgain, called] = [countsSoFar(), count("operationAOTJSONSourceAbandon"), count("operationAOTJSONParseExtraMembers")];
  let sum = 0;
  for (const text of texts) sum += (JSON.parse(text) as Segment).to.y;
  const after = countsSoFar();
  const isAsExpected = (readAgainExpected > 0 || callsOutsideTheParser(after) === callsOutsideTheParser(before)) && count("operationAOTJSONSourceAbandon") - readAgain === readAgainExpected && count("operationAOTJSONParseExtraMembers") - called === callsForUndeclaredKeys;
  console.log(what, sum, counted ? isAsExpected : true);
}
const point = '{"x":1,"y":2}';
measure("declared order", [`{"id":1,"from":${point},"to":${point},"tags":[]}`], 0, 0);
measure("another order", [`{"tags":[],"to":{"y":2,"x":1},"from":${point},"id":1}`], 0, 0);
measure("one undeclared key", [`{"id":1,"from":${point},"to":${point},"tags":[],"o":1}`], 0, 1);
measure("ten undeclared keys in a row are one call", [`{"id":1,"from":${point},"to":${point},"tags":[],"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"j":10}`], 0, 1);
measure("undeclared keys in three places", [`{"a":1,"id":1,"b":[1],"c":{"d":1},"from":${point},"to":${point},"tags":[],"e":null}`], 0, 3);
measure("undeclared keys below", [`{"id":1,"from":{"x":1,"o":1,"y":2},"to":{"p":1,"q":2,"x":1,"y":2},"tags":[]}`], 0, 2);
measure("an index key", [`{"id":1,"from":${point},"to":${point},"tags":[],"0":1}`], 0, 1);
measure("__proto__", [`{"id":1,"from":${point},"to":${point},"tags":[],"__proto__":1}`], 0, 1);
measure("an escape in an undeclared key", [`{"id":1,"from":${point},"to":${point},"tags":[],"\\u0061":1,"caf\\u00e9":2}`], 0, 1);
measure("an escape in a declared key is read again", [`{"\\u0069d":1,"from":${point},"to":${point},"tags":[]}`], 1, 1);
