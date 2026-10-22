const log = [];
const top = { set x(v) { log.push("top setter " + v); }, get x() { return "top"; } };
const middle = { __proto__: top, x() {} };
const bottom = { __proto__: middle };
const under = Object.create(middle);
function store(o, v) { o.x = v; return typeof o.x + ":" + Object.hasOwn(o, "x"); }
console.log(store(bottom, 1), store(under, 2), store({ __proto__: top }, 3), store({ __proto__: middle }, 4), log.splice(0).join());
const value = { __proto__: top, x: 5 };
console.log(value.x, Object.hasOwn(value, "x"), store({ __proto__: value }, 6), log.splice(0).join());
