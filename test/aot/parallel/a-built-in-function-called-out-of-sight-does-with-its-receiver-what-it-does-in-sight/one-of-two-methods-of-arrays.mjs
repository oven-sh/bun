const like = { get length() { seen.push("length"); return 2; }, get 0() { seen.push("0"); return "a"; }, get 1() { seen.push("1"); return "b"; } };
const seen = [];
const pick = process.argv.length > 5 ? Array.prototype.filter : Array.prototype.map;
console.log(pick.call(like, x => x + x).join(), seen.join());
