const makers = (0, eval)(`[
  () => [1, 2, 3], () => [1, , 3], () => [1.5, 2.5], () => [1.5, , 2.5], () => [], () => new Array(3),
  () => ({ length: 2, 0: "a", 1: "b" }), () => (function () { return arguments; })(7, 8), () => new Uint8Array([4, 5]),
  () => null, () => undefined, () => 5, () => "ab", () => Symbol.iterator, () => ({}), () => ({ length: -1 }),
  () => { const list = [1, 2]; Object.defineProperty(list, 0, { get() { return "got"; } }); return list; },
  () => { class Row extends Array {} return Row.of(1, 2); },
  () => { const list = [1]; list[200000] = 0; list.length = 3; return list; },
  () => Object.freeze([1, 2]), () => new Proxy([1, 2], {}), () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
]`);
function show() { return arguments.length + ":" + Array.prototype.join.call(arguments, ","); }
function rest(...all) { return all.length + ":" + all.join(","); }
function tail(callee, list) { return callee.apply(null, list); }
function inside(callee, list) { const answer = callee.apply(null, list); return answer; }
function reflected(callee, list) { return Reflect.apply(callee, null, list); }
function reflectedInside(callee, list) { const answer = Reflect.apply(callee, null, list); return answer; }
for (const make of makers) {
  const said = [];
  for (const call of [tail, inside, reflected, reflectedInside]) {
    for (const callee of [show, rest, Math.max]) {
      try { said.push(String(call(callee, make()))); } catch (error) { said.push(error.constructor.name + ": " + error.message); }
    }
  }
  console.log(said.join(" . "));
}
