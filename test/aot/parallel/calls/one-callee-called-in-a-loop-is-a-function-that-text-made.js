// A loop calls one callee again and again. The callee is a function that text made at run time, or anything else that is no function of the program.
const nothing = String(Date.now()).slice(99);
const text = (parameters, body) => new Function(...parameters, body + nothing);
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return `${error.constructor.name}: ${error.message.split(" (In ")[0]}`;
  }
};

function total(callee, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + callee(i, 2)) | 0;
  return sum;
}
function joined(callee, turns) {
  let all = "";
  for (let i = 0; i < turns; i++) all += callee() + callee(i) + callee(i, i, i) + callee(i, i, i, i) + callee(i, i, i, i, i, i) + ";";
  return all;
}

const add = text(["a", "b"], "return a + b;");
const strict = text(["a", "b"], "'use strict'; return a * b + (this === undefined ? 1 : 0);");
const sloppy = text(["a"], "return a + (this === globalThis ? 1 : 0);");
const count = text([], "return arguments.length;");
const rest = text(["...list"], "return list.length;");
const withDefault = text(["a = 5", "b = a"], "return a + b;");
const arrow = text([], "return (a, b) => a - b;")();
const inner = text(["step"], "return function (a) { return a + step; };")(3);
const method = text([], "return { m(a) { return a + 1; } }.m;")();
const generator = text([], "return function* (a) { yield a; };")();
const asynchronous = text([], "return async function (a) { return a; };")();
for (const callee of [add, strict, sloppy, count, rest, withDefault, arrow, inner, method]) console.log(total(callee, 1000));
console.log(joined(count, 3), joined(rest, 3));
console.log(typeof total(generator, 3), typeof total(asynchronous, 3));

// What is no such function goes the way it always went.
const bound = add.bind(null, 10);
const boundTwice = bound.bind(null, 20);
const proxy = new Proxy(add, {
  apply(target, receiver, list) {
    return target(...list) + 100;
  },
});
for (const callee of [bound, boundTwice, proxy, Math.max, Math.imul, Number, (a, b) => a + b, function (a) { return a; }])
  console.log(total(callee, 1000));
for (const callee of [text([], "return class {};")(), class {}, {}, null, undefined, 5, "text", Symbol.iterator, new Proxy({}, {})])
  console.log(attempt(() => total(callee, 3)));

// The function changes between two calls of one loop: it is constructed, gets properties, another prototype, is frozen.
function changing(callee, change) {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    sum += callee(i, 1);
    if (i === 100) change(callee);
  }
  return sum;
}
const fresh = () => text(["a", "b"], "return a + b;");
console.log(
  changing(fresh(), f => new f(1, 2)),
  changing(fresh(), f => (f.extra = 1)),
  changing(fresh(), f => f.prototype),
  changing(fresh(), f => Object.setPrototypeOf(f, null)),
  changing(fresh(), f => Object.freeze(f)),
  changing(fresh(), f => Object.defineProperty(f, "name", { value: "renamed" })),
  changing(fresh(), f => f.bind(null)),
);

// It throws, and it calls back into the program.
const throwsAt = text(["i"], "if (i === 7) throw new RangeError('at ' + i); return i;");
console.log(attempt(() => total(throwsAt, 100)));
const callsBack = text(["back"], "return function (i) { return back(i) + 1; };")(i => i * 2);
console.log(total(callsBack, 1000));
const deep = text(["self"], "return function down(i) { return i > 0 ? down(i - 1) + 1 : 0; };")();
console.log(total(i => deep(i & 63), 1000), attempt(() => deep(1e7)).slice(0, 10));

// The loop of the module itself.
let sum = 0;
for (let i = 0; i < 1000; i++) sum = (sum + add(i, 1)) | 0;
console.log(sum);
