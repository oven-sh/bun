const like = { get length() { seen.push("length"); return 2; }, get 0() { seen.push("0"); return "a"; }, get 1() { seen.push("1"); return "b"; } };
const seen = [];
const bound = (process.argv.length > 5 ? Array.prototype.concat : Array.prototype.reduce).bind(like);
console.log(bound((a, b) => a + b), seen.join());
