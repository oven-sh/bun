const like = { get length() { seen.push("length"); return 2; }, get 0() { seen.push("0"); return "a"; }, get 1() { seen.push("1"); return "b"; } };
const seen = [];
function run(method, on, ...rest) { return method.apply(on, rest); }
run(Math.max, null, 1);
console.log(run(Array.prototype.indexOf, like, "b"), seen.join());
