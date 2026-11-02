// How the console, Bun.inspect and node:util show `Promise` in a program that constructs promises with `new`.
import util from "node:util";

console.log(Promise);
const pending = new Promise(() => {});
console.log(Promise);
console.log([Promise], { Promise }, new Map([[Promise, Promise]]), new Set([Promise]));
console.log(Bun.inspect(Promise), util.inspect(Promise), String(Promise));
console.log("%o | %O | %s", Promise, Promise, Promise);
console.log(new Proxy(Promise, {}), Promise.bind(null), pending.constructor, Promise[Symbol.species], Promise.prototype.constructor);
console.log(util.types.isAsyncFunction(Promise), util.types.isGeneratorFunction(Promise), typeof Promise);
console.log(Promise.resolve, Promise.try, Promise.withResolvers, Promise.prototype.then, Promise.prototype.finally);
console.table([{ shown: Promise }]);
