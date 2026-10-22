function who() { return this === undefined ? "strict" : typeof this; }
function Old() { this.n = 1; }
class Counter { constructor() { this.n = 2; } get() { return this.n; } static make() { return new this().n; } }
const object = { m() { return typeof this; } };
globalThis.fromNested = [who(), new Old().n, new Counter().get(), Counter.make(), object.m()].join();
