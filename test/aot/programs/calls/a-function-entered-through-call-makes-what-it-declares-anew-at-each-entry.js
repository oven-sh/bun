// A function is entered through call, apply and Reflect.apply: once where it stands, twice, in a loop, and beside a plain call.
const made = [];
(function () {
  function Once() {}
  Once.prototype.tag = "once";
  made.push(new Once().tag, this === globalThis);
}).call(globalThis);
console.log(made.join());

const twice = function (tag) {
  function Inner() {}
  Inner.prototype.tag = tag;
  made.push(Inner);
  return new Inner();
};
const a = twice.call(null, "a");
const b = twice.call(null, "b");
console.log(a.tag, b.tag, a instanceof made[2], b instanceof made[2], made[2] === made[3]);

for (let i = 0; i < 3; i++) {
  (function (n) {
    function Turn() {}
    Turn.prototype.n = n;
    made.push(new Turn());
  }).call(null, i);
}
console.log(made.slice(4).map(turn => turn.n).join(), Object.getPrototypeOf(made[4]) === Object.getPrototypeOf(made[5]));

const both = function (tag) {
  let count = 0;
  return function () {
    return tag + ++count;
  };
};
const first = both.call(null, "x");
const second = both("y");
console.log(first(), first(), second(), first());

const applied = function () {
  function Kept() {}
  return Kept;
};
console.log(Reflect.apply(applied, null, []) === applied.apply(null, []));

function outer(tag) {
  return (function () {
    function Made() {}
    Made.prototype.tag = tag;
    return new Made();
  }).call(this);
}
console.log(outer("p").tag, outer("q").tag, Object.getPrototypeOf(outer("r")) === Object.getPrototypeOf(outer("s")));
