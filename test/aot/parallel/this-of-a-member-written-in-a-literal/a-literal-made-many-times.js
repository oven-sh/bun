// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
function make(start) { return { n: start, bump() { this.n += 1; return this.n; }, get next() { return this.n + 1; } }; }
globalThis.madeUpMake = make;
const first = make(process.argv.length), second = make(100);
const below = Object.create(first);
console.log(first.bump() - process.argv.length, second.bump(), below.next - process.argv.length, below.bump() - process.argv.length, first.n - process.argv.length);
