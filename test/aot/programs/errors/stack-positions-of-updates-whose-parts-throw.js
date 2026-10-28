// Where a stack trace shows the function around an update of a property, for each form of update and each way in which its read, its conversion or its store throws or runs a function that throws.
function frames(error) {
  return error.stack.split("\n").slice(1, 3).map(line => line.replace(/^.*?([a-zA-Z<>.]+) \(.*:(\d+:\d+)\)$/, "$1@$2").replace(/^.*:(\d+:\d+)$/, "@$1")).join(" ");
}
function report(name, error) {
  console.log(name, error.constructor.name, frames(error));
}
const makeGetter = () => ({ get x() { throw new Error("getter"); }, set x(v) {} });
for (const run of [
  function postIncrementKeyGetter(o, k) { "use strict"; o[k]++; },
  function preIncrementKeyGetter(o, k) { "use strict"; ++o[k]; },
  function postDecrementKeyGetter(o, k) { "use strict"; o[k]--; },
  function usedPostIncrementKeyGetter(o, k) { "use strict"; return o[k]++ + 1; },
  function addKeyGetter(o, k) { "use strict"; o[k] += 1; },
  function logicalKeyGetter(o, k) { "use strict"; o[k] &&= 2; },
  function nullishKeyGetter(o, k) { "use strict"; o[k] ??= 2; },
  function postIncrementNameGetter(o, k) { "use strict"; o.x++; },
  function preIncrementNameGetter(o, k) { "use strict"; ++o.x; },
  function addNameGetter(o, k) { "use strict"; o.x += 1; },
  function logicalNameGetter(o, k) { "use strict"; o.x &&= 2; },
  function behindACallGetter(o, k) { "use strict"; String(k); o[k]++; },
  function onTheNextLineGetter(o, k) { "use strict"; o
    [k]++; },
  function deepKeyGetter(o, k) { "use strict"; const h = { o }; h.o[k]++; },
  function textKeyGetter(o, k) { "use strict"; o["x"]++; },
]) {
  try { run(makeGetter(), "x"); console.log(run.name, "no error"); } catch (error) { report(run.name, error); }
  try { run(undefined, "x"); } catch (error) { report(run.name, error); }
}
const makeSetter = () => ({ get x() { return 1; }, set x(v) { throw new Error("setter"); } });
for (const run of [
  function postIncrementKeySetter(o, k) { "use strict"; o[k]++; },
  function preIncrementKeySetter(o, k) { "use strict"; ++o[k]; },
  function postDecrementKeySetter(o, k) { "use strict"; o[k]--; },
  function usedPostIncrementKeySetter(o, k) { "use strict"; return o[k]++ + 1; },
  function addKeySetter(o, k) { "use strict"; o[k] += 1; },
  function logicalKeySetter(o, k) { "use strict"; o[k] &&= 2; },
  function nullishKeySetter(o, k) { "use strict"; o[k] ??= 2; },
  function postIncrementNameSetter(o, k) { "use strict"; o.x++; },
  function preIncrementNameSetter(o, k) { "use strict"; ++o.x; },
  function addNameSetter(o, k) { "use strict"; o.x += 1; },
  function logicalNameSetter(o, k) { "use strict"; o.x &&= 2; },
  function behindACallSetter(o, k) { "use strict"; String(k); o[k]++; },
  function onTheNextLineSetter(o, k) { "use strict"; o
    [k]++; },
  function deepKeySetter(o, k) { "use strict"; const h = { o }; h.o[k]++; },
  function textKeySetter(o, k) { "use strict"; o["x"]++; },
]) {
  try { run(makeSetter(), "x"); console.log(run.name, "no error"); } catch (error) { report(run.name, error); }
  try { run(undefined, "x"); } catch (error) { report(run.name, error); }
}
const makeValue = () => ({ x: { valueOf() { throw new Error("value"); } } });
for (const run of [
  function postIncrementKeyValue(o, k) { "use strict"; o[k]++; },
  function preIncrementKeyValue(o, k) { "use strict"; ++o[k]; },
  function postDecrementKeyValue(o, k) { "use strict"; o[k]--; },
  function usedPostIncrementKeyValue(o, k) { "use strict"; return o[k]++ + 1; },
  function addKeyValue(o, k) { "use strict"; o[k] += 1; },
  function logicalKeyValue(o, k) { "use strict"; o[k] &&= 2; },
  function nullishKeyValue(o, k) { "use strict"; o[k] ??= 2; },
  function postIncrementNameValue(o, k) { "use strict"; o.x++; },
  function preIncrementNameValue(o, k) { "use strict"; ++o.x; },
  function addNameValue(o, k) { "use strict"; o.x += 1; },
  function logicalNameValue(o, k) { "use strict"; o.x &&= 2; },
  function behindACallValue(o, k) { "use strict"; String(k); o[k]++; },
  function onTheNextLineValue(o, k) { "use strict"; o
    [k]++; },
  function deepKeyValue(o, k) { "use strict"; const h = { o }; h.o[k]++; },
  function textKeyValue(o, k) { "use strict"; o["x"]++; },
]) {
  try { run(makeValue(), "x"); console.log(run.name, "no error"); } catch (error) { report(run.name, error); }
  try { run(undefined, "x"); } catch (error) { report(run.name, error); }
}
const makeProxyGet = () => new Proxy({ x: 1 }, { get() { throw new Error("proxy get"); } });
for (const run of [
  function postIncrementKeyProxyGet(o, k) { "use strict"; o[k]++; },
  function preIncrementKeyProxyGet(o, k) { "use strict"; ++o[k]; },
  function postDecrementKeyProxyGet(o, k) { "use strict"; o[k]--; },
  function usedPostIncrementKeyProxyGet(o, k) { "use strict"; return o[k]++ + 1; },
  function addKeyProxyGet(o, k) { "use strict"; o[k] += 1; },
  function logicalKeyProxyGet(o, k) { "use strict"; o[k] &&= 2; },
  function nullishKeyProxyGet(o, k) { "use strict"; o[k] ??= 2; },
  function postIncrementNameProxyGet(o, k) { "use strict"; o.x++; },
  function preIncrementNameProxyGet(o, k) { "use strict"; ++o.x; },
  function addNameProxyGet(o, k) { "use strict"; o.x += 1; },
  function logicalNameProxyGet(o, k) { "use strict"; o.x &&= 2; },
  function behindACallProxyGet(o, k) { "use strict"; String(k); o[k]++; },
  function onTheNextLineProxyGet(o, k) { "use strict"; o
    [k]++; },
  function deepKeyProxyGet(o, k) { "use strict"; const h = { o }; h.o[k]++; },
  function textKeyProxyGet(o, k) { "use strict"; o["x"]++; },
]) {
  try { run(makeProxyGet(), "x"); console.log(run.name, "no error"); } catch (error) { report(run.name, error); }
  try { run(undefined, "x"); } catch (error) { report(run.name, error); }
}
const makeProxySet = () => new Proxy({ x: 1 }, { set() { throw new Error("proxy set"); } });
for (const run of [
  function postIncrementKeyProxySet(o, k) { "use strict"; o[k]++; },
  function preIncrementKeyProxySet(o, k) { "use strict"; ++o[k]; },
  function postDecrementKeyProxySet(o, k) { "use strict"; o[k]--; },
  function usedPostIncrementKeyProxySet(o, k) { "use strict"; return o[k]++ + 1; },
  function addKeyProxySet(o, k) { "use strict"; o[k] += 1; },
  function logicalKeyProxySet(o, k) { "use strict"; o[k] &&= 2; },
  function nullishKeyProxySet(o, k) { "use strict"; o[k] ??= 2; },
  function postIncrementNameProxySet(o, k) { "use strict"; o.x++; },
  function preIncrementNameProxySet(o, k) { "use strict"; ++o.x; },
  function addNameProxySet(o, k) { "use strict"; o.x += 1; },
  function logicalNameProxySet(o, k) { "use strict"; o.x &&= 2; },
  function behindACallProxySet(o, k) { "use strict"; String(k); o[k]++; },
  function onTheNextLineProxySet(o, k) { "use strict"; o
    [k]++; },
  function deepKeyProxySet(o, k) { "use strict"; const h = { o }; h.o[k]++; },
  function textKeyProxySet(o, k) { "use strict"; o["x"]++; },
]) {
  try { run(makeProxySet(), "x"); console.log(run.name, "no error"); } catch (error) { report(run.name, error); }
  try { run(undefined, "x"); } catch (error) { report(run.name, error); }
}
const makeFrozen = () => Object.freeze({ x: 1 });
for (const run of [
  function postIncrementKeyFrozen(o, k) { "use strict"; o[k]++; },
  function preIncrementKeyFrozen(o, k) { "use strict"; ++o[k]; },
  function postDecrementKeyFrozen(o, k) { "use strict"; o[k]--; },
  function usedPostIncrementKeyFrozen(o, k) { "use strict"; return o[k]++ + 1; },
  function addKeyFrozen(o, k) { "use strict"; o[k] += 1; },
  function logicalKeyFrozen(o, k) { "use strict"; o[k] &&= 2; },
  function nullishKeyFrozen(o, k) { "use strict"; o[k] ??= 2; },
  function postIncrementNameFrozen(o, k) { "use strict"; o.x++; },
  function preIncrementNameFrozen(o, k) { "use strict"; ++o.x; },
  function addNameFrozen(o, k) { "use strict"; o.x += 1; },
  function logicalNameFrozen(o, k) { "use strict"; o.x &&= 2; },
  function behindACallFrozen(o, k) { "use strict"; String(k); o[k]++; },
  function onTheNextLineFrozen(o, k) { "use strict"; o
    [k]++; },
  function deepKeyFrozen(o, k) { "use strict"; const h = { o }; h.o[k]++; },
  function textKeyFrozen(o, k) { "use strict"; o["x"]++; },
]) {
  try { run(makeFrozen(), "x"); console.log(run.name, "no error"); } catch (error) { report(run.name, error); }
  try { run(undefined, "x"); } catch (error) { report(run.name, error); }
}
