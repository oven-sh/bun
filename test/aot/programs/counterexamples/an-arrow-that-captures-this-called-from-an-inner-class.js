// An arrow function keeps the `this` of the method that made it when a static method of an inner class calls it.
const o = { m() { const f = () => this; return class { static k() { return f(); } }.k(); } };
console.log(o.m() === o);
