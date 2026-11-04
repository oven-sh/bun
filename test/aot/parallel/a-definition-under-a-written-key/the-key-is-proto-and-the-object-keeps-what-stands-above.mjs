class A { a = 1; m() { return "method"; } }
const o = new A;
function act() { Object.defineProperty(o, "__proto__", { value: { m() { return "other"; } }, enumerable: true }); }
act();
console.log(o.m(), o instanceof A, Object.getPrototypeOf(o) === A.prototype, typeof o.__proto__.m, Object.keys(o).join());
