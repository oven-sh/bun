// `options.signal` asked at one place of objects of this realm and of another one (node:vm), none of which has such a property.
// What stands above an object of the other realm changes without a word to this one: a store, an accessor on its Object.prototype, another object laid above that, a store on the object itself.
// EACH PLACE IS WARMED ON ITS OWN, 3,000 times in turns by all kinds, before anything changes; the collector runs in between.
const vm = require("node:vm");
class Options { constructor(n) { this.n = n; } }
const readers = [o => o.signal, o => o.signal, o => o.signal, o => o.signal, o => o.signal];
const ways = [
    "(function (one) { Object.prototype.signal = 'stored on the Object.prototype of the other realm'; })",
    "(function (one) { Object.defineProperty(Object.prototype, 'signal', { configurable: true, get() { return 'an accessor there, of ' + (this === one); } }); })",
    "(function (one) { Object.setPrototypeOf(Object.prototype.constructor.prototype, null); one.signal = 'stored on the object there'; })",
    "(function (one) { one.signal = 'stored'; delete one.signal; })",
    "(function (one) { Object.setPrototypeOf(one, { signal: 'another prototype there' }); })",
];
const lines = [];
let next = 0;
for (const way of ways) {
    const context = vm.createContext({ });
    const makers = [
        vm.runInContext("(function (i) { return { n: i }; })", context),
        vm.runInContext("(function (i) { return { m: i, n: i }; })", context),
        vm.runInContext("(function (i) { return Object.create({ above: i }); })", context),
        i => new Options(i),
        i => ({ n: i, l: i }),
        i => Object.create(null),
    ];
    const change = vm.runInContext(way, context);
    const signalOf = readers[next++];
    const all = () => makers.map((make, index) => String(signalOf(make(index)))).join(" . ");
    let found = 0;
    for (let turn = 0; turn < 3000; turn++) found += signalOf(makers[turn % makers.length](turn)) === undefined ? 0 : 1;
    const one = makers[0](1), other = makers[0](2);
    Bun.gc(true);
    lines.push(found + " . " + all());
    change(one);
    lines.push(" > " + signalOf(one) + " | " + signalOf(other) + " | " + all());
    Bun.gc(true);
    for (let turn = 0; turn < 3000; turn++) found += signalOf(makers[turn % makers.length](turn)) === undefined ? 0 : 1;
    lines.push(" > " + found + " | " + signalOf(one) + " | " + signalOf(other) + " | " + all());
}
console.log(lines.join("\n"));
