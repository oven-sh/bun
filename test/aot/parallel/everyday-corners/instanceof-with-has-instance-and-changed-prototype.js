// Instanceof with has instance and changed prototype: compiled answers as plain.
function F() {}
const o = new F();
console.log(o instanceof F);
F.prototype = {};
console.log(o instanceof F, new F() instanceof F);
const Even = { [Symbol.hasInstance]: n => n % 2 === 0 };
console.log(
  2 instanceof Even,
  3 instanceof Even,
  (() => {
    try {
      return o instanceof {};
    } catch (e) {
      return e.constructor.name;
    }
  })(),
  (() => {
    try {
      return o instanceof (() => {});
    } catch (e) {
      return e.constructor.name;
    }
  })(),
);
