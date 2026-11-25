const like = { get length() { seen.push("length"); return 2; }, get 0() { seen.push("0"); return "a"; }, get 1() { seen.push("1"); return "b"; } };
const seen = [];
const table = { join: Array.prototype.join, slice: Array.prototype.slice };
console.log(String(table[process.argv.length > 5 ? "slice" : "join"].call(like, "-")), seen.join());
