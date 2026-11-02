// A function is called through a proxy that has no trap for calls. A call that names no receiver hands the function undefined, whatever its other calls hand it.
const self: any = { name: "self", n: 1.5 };
function target(this: any, a: any): any { return this.n + a; }
console.log(target.call(self, 1));
const called: any = new Proxy(target, {});
try { console.log(called(10)); } catch (error) { console.log("throws", (error as Error).constructor.name); }
function which(this: any): string { return this === self ? "self" : this === undefined ? "undefined" : "other"; }
console.log(which.call(self));
const asked: any = new Proxy(which, {});
console.log(asked(), asked``, { asked }.asked(), asked.call(self));
