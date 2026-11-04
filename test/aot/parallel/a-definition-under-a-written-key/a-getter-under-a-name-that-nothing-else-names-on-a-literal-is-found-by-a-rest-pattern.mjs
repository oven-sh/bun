const o = { a: 1, b: 2 };
const suffix = Date.now() > 0 ? "Name" : "";
function act() { Object.defineProperty(o, "hiddenName", { get() { this.b = "text"; return 7; }, enumerable: true }); }
act();
console.log(typeof o.a, typeof o.b);
console.log((({ a, ...rest }) => Object.values(rest).pop())(o));
console.log(typeof o.a, typeof o.b);
