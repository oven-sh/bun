// The callback of an array method is looked at once, ahead of the method's loop: whatever it is, each call does what a call does. A loop of the program's own is left as it is.
// CALLS+ Array$map ResolveCallValue3
// CALLS- Array$map [^e]CallValue3
// CALLS+ Array$some ResolveCallValue3
// CALLS- eachOf ResolveCallValue
// CALLS- changing ResolveCallValue
// CALLS- once ResolveCallValue
function eachOf(list, f) {
  let out = "";
  for (let i = 0; i < list.length; i++) out += f(list[i], i) + ",";
  return out;
}
function changing(list, functions) {
  let out = "";
  for (let i = 0; i < list.length; i++) {
    const f = functions[i % functions.length];
    out += f(list[i], i) + ",";
  }
  return out;
}
function once(list, f) {
  return f(list[0], 0);
}
function nested(lists, functions) {
  let out = "";
  for (let i = 0; i < lists.length; i++) {
    const f = functions[i];
    for (let k = 0; k < lists[i].length; k++) out += f(lists[i][k], k) + ",";
  }
  return out;
}
function guarded(list, f) {
  let out = "";
  for (let i = 0; i < list.length; i++) {
    try {
      out += f(list[i], i) + ",";
    } catch (error) {
      out += "(" + described(error) + "),";
    }
  }
  return out;
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return described(error);
  }
}
function described(error) {
  return error.constructor.name + (error.isMine ? ": " + error.message : "");
}
function mine(error) {
  error.isMine = true;
  return error;
}

const list = [1, 2, 3];
let seen = 0;
const callees = {
  none: () => "none",
  one: a => a * 2,
  two: (a, b) => a + b,
  three: (a, b, c) => a + "" + b + c,
  five: (a, b, c, d, e) => [a, b, c, d, e].join("|"),
  rest: (...all) => all.length + ":" + all.join("|"),
  defaults: (a, b, c = "c") => a + b + c,
  counts: function () { return arguments.length + ":" + arguments[1]; },
  sloppyThis: function () { return typeof this; },
  strictThis: function () { "use strict"; return typeof this; },
  captures: a => (seen += a),
  host: String,
  hostTwo: Math.max,
  parse: parseInt,
  bound: function (x, a, b) { return this.tag + x + a + b; }.bind({ tag: "t" }, "x"),
  boundHost: Math.min.bind(null, 2),
  proxy: new Proxy((a, b) => a - b, {}),
  trapped: new Proxy(() => 0, { apply: (target, self, all) => "trapped " + all.length }),
  asynchronous: async a => a,
  generator: function* (a) { yield a; },
  method: { m(a) { return "m" + a; } }.m,
  getter: Object.getOwnPropertyDescriptor({ get g() { return "g"; } }, "g").get,
};
for (const name in callees) console.log(name, String(eachOf(list, callees[name])));

for (const notCallable of [undefined, null, 1, "text", {}, [], Symbol.iterator, class C {}, 1n]) {
  console.log(attempt(() => eachOf(list, notCallable)));
  console.log(eachOf([], notCallable) === "");
  console.log(guarded(list, notCallable));
}

let calls = 0;
console.log(attempt(() => eachOf(list, a => { if (++calls === 2) throw mine(new RangeError("second")); return a; })), calls);
console.log(guarded(list, a => { if (a === 2) throw mine(new TypeError("two")); return a; }));

function growing(a) {
  growing["p" + a] = a;
  growing.prototype = { a };
  return Object.keys(growing).join("");
}
console.log(eachOf(list, growing));
const arrow = a => {
  arrow.tag = (arrow.tag ?? "") + a;
  Object.setPrototypeOf(arrow, a === 2 ? null : Function.prototype);
  return arrow.tag;
};
console.log(eachOf(list, arrow));
const frozen = Object.freeze(a => a);
console.log(eachOf(list, frozen));

console.log(changing([1, 2, 3, 4], [a => a, String, (a, b) => a * b]));
const handedOver = [once];
console.log(handedOver[0](list, (a, b) => a + b));
console.log(nested([[1, 2], [3], [], [4, 5]], [a => a, String, undefined, (a, b) => a * b]));
console.log(attempt(() => nested([[1], [2]], [a => a, undefined])));

function deep(n) {
  let most = n;
  for (let i = 0; i < 1; i++) most = again(() => deep(n + 1));
  return most;
}
function again(f) {
  let result;
  for (let i = 0; i < 1; i++) result = f();
  return result;
}
console.log(attempt(() => deep(0)).slice(0, 10));
function deepThroughForEach(n) {
  [0].forEach(() => deepThroughForEach(n + 1));
}
console.log(attempt(() => deepThroughForEach(0)).slice(0, 10));

const array = [3, 1, 2];
for (const name in callees) {
  const f = callees[name];
  console.log(
    name,
    String(array.map(f)),
    array.filter(f).length,
    array.some(f),
    array.every(f),
    String(array.find(f)),
    array.findIndex(f),
    String(array.reduce(f, 0)),
    String(array.flatMap(f)),
  );
}
for (const notCallable of [undefined, null, 1, {}, class C {}]) {
  for (const method of ["forEach", "map", "filter", "some", "every", "find", "findIndex", "reduce", "flatMap"]) {
    console.log(method, String(attempt(() => array[method](notCallable, 0))), "(" + String(attempt(() => [][method](notCallable, 0))) + ")");
  }
}
const self = { tag: "self" };
array.forEach(function (a) { console.log(this === self, a); }, self);
array.forEach(function (a) { "use strict"; console.log(this, a); }, 7);
const shrinking = [1, 2, 3, 4];
shrinking.forEach((a, i, all) => { all.length = 2; console.log(a, i, all.length); });
const turning = [1, 2, 3];
turning.forEach((a, i, all) => { all[i + 1] = i ? "text" : 1.5; console.log(a); });
