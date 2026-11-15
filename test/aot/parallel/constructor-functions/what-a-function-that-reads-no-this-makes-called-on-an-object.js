// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
function Plain() {}
const held = { x: process.argv.length };
function read(o) { return o.x - process.argv.length; }
console.log(Plain.call(held), read(held), Object.keys(held).join());
