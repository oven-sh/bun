function report(list) {
  console.log("promise-species.then--bound-getter--closure-before--deep-use--reads-late-const-function", ...list);
}
const state = 0, shared = 0;
function readOwn() {}
function show() {}
function promiseOf(constructor) {
  const promise = Promise.resolve(1);
  promise.constructor = constructor;
  return promise;
}
const o = {};
Object.defineProperty(o, Symbol.species, { get: function() {
  lateFunctionPromise;
}.bind(), configurable: !0 });
async function run(x, s) {
  const before = s.n, ownBefore = readOwn(), firstBefore = [0], lengthBefore = shared;
  let r, kind;
  try {
    r = await promiseOf(x).then();
    kind = r;
  } catch (e) {}
  return show + kind;
}
function runThird(x, s) {
  return run(x, s);
}
function runSecond(x, s) {
  return runThird(x, s);
}
function runFirst(x, s) {
  return runSecond(x, s);
}
report(await runFirst(o, state));
