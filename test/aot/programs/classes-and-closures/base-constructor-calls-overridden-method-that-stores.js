// The base constructor calls a method that the subclass overrides, and the override creates a field before the field initializers of the subclass run.
class Par { constructor() { this.init(); } init() {} }
class Chi extends Par { q = 5; init() { this.seen = 7; } }
const c = new Chi();
console.log(c.seen, c.q, Object.keys(c).join(), JSON.stringify(c));
