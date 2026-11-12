// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
function Plain() {}
function sum(list) { let total = 0; for (const o of list) total += o.x; return total; }
const list = [];
for (let i = 0; i < process.argv.length + 3; i++) { const o = new Plain(); o.x = i; if (i & 1) o.y = "odd"; list.push(o); }
console.log(sum(list) - (list.length * (list.length - 1)) / 2, list[1].y, list[0].y);
