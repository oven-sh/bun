const like = { get length() { seen.push("length"); return 2; }, get 0() { seen.push("0"); return "a"; }, get 1() { seen.push("1"); return "b"; } };
const seen = [];
const each = (process.argv.length > 5 ? Array.prototype.some : Array.prototype.forEach).bind(like);
each(function (value, index, whole) { seen.push(whole === like); });
console.log(seen.join());
