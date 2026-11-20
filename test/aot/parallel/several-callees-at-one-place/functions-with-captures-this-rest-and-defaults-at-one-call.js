// Two to four functions at one call: captures, `this`, a rest list, defaults, `arguments`, more and fewer arguments than parameters.
function adder(n) { return (x) => x + n; }
const addFive = adder(5);
const addNine = adder(9);
const twice = (x) => x * 2;
function counted() { return arguments.length; }
function gathered(first, ...rest) { return first + rest.length * 100; }
function defaulted(x, y = x + 1000) { return y; }
function whoCalls() { "use strict"; return this === undefined ? -1 : this.v; }
function whoCallsToo() { "use strict"; return this === undefined ? -2 : this.v + 1; }
const holder = { v: 40, first: whoCalls, second: whoCallsToo };

const log = [];
for (let i = 0; i < 8; i++) {
    const f = i & 1 ? twice : addFive;
    log.push(f(i));
    const sameFunction = i % 3 === 0 ? addFive : i % 3 === 1 ? addNine : twice;
    log.push(sameFunction(i));
    const g = i % 4 === 0 ? counted : i % 4 === 1 ? gathered : i % 4 === 2 ? defaulted : twice;
    log.push(g(i), g(i, 2, 3), g());
    const bare = i & 1 ? whoCalls : whoCallsToo;
    log.push(bare());
    const name = i & 1 ? "first" : "second";
    log.push(holder[name]());
    const method = i & 1 ? holder.first : holder.second;
    log.push(method.call(holder));
}
console.log(log.join());
