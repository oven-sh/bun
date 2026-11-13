// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
const counter = { n: process.argv.length, bump() { this.n += 1; return this.n; }, get next() { return this.n + 1; } };
globalThis.madeUpCounter = counter;
console.log(counter.bump() - process.argv.length, counter.next - process.argv.length);
