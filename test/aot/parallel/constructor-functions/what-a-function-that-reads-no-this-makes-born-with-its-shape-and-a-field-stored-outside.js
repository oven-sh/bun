// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
function Plain() {}
function read(o, by) { return o.x + by; }
function isOne(o) { return o instanceof Plain; }
const n = process.argv.length;
const o = new Plain();
o.x = n;
console.log(isOne(o), isOne({}), read(o, 1) - n);
