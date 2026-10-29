// How the console, Bun.inspect and node:util show subclasses of `Promise` in a program that constructs them.
import util from "node:util";

class Below extends Promise {}
class Lower extends Below {}
const Anonymous = class extends Promise {};
function Old() {}
Object.setPrototypeOf(Old, Promise);
const made = [new Below(() => {}), new Lower(() => {}), new Anonymous(() => {}), Reflect.construct(Promise, [() => {}], Below)];
console.log(Below, Lower, Anonymous, Old, (0, class extends Promise {}));
console.log([Below, Lower], { Below, Lower }, new Map([[Below, Lower]]), new Set([Anonymous]));
console.log(Bun.inspect(Below), Bun.inspect(Lower), Bun.inspect(Anonymous));
console.log(util.inspect(Below), util.inspect(Lower), util.inspect(Anonymous));
console.log(new Proxy(Below, {}), Below.bind(null), Below[Symbol.species], Object.getPrototypeOf(Below));
console.log(made.map(one => one.constructor));
console.log(made);
console.table([{ below: Below, lower: Lower }]);
