// A toString that answers a text the first time and a new object the second time: the second conversion to a property key throws a TypeError.
let calls = 0;
const o = {};
Object.defineProperties(o, { toString: { value: function () { return calls++ % 2 ? {} : "label"; }, writable: true, configurable: true } });
function run(x) {
  try { ({})[x]; } catch (e) { console.log(e.name); }
}
run(new SuppressedError(o, 0).error);
run(new SuppressedError(o, 0).error);
