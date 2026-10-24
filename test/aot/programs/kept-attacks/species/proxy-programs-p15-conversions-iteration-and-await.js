// Species: proxy programs  conversions iteration and await. It prints what plain Bun prints.
const log = [];
class Money { constructor(n) { this.n = n; } valueOf() { log.push("valueOf " + (this instanceof Money)); return this.n; } toString() { return "m" + this.n; } }
class Bag { constructor() { this.items = [1, 2]; } *[Symbol.iterator]() { log.push("iterate"); yield* this.items; } }
class Later { then(resolve) { log.push("then"); resolve(7); } }
const m = new Proxy(new Money(3), {});
log.push(String(m + 1), `${m}`, String(m > 2));
log.push([...new Proxy(new Bag(), {})].join());
for (const x of new Proxy(new Bag(), {})) log.push("x" + x);
(async () => { log.push(String(await new Proxy(new Later(), {}))); console.log(log.join("; ")); })();
