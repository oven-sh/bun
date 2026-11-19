const o = { v: Function.prototype.bind.call(Bun.Cookie, null).name };
console.log(o.v);
