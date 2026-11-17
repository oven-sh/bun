const like = { get length() { seen.push("length"); return 2; }, get 0() { seen.push("0"); return "a"; }, get 1() { seen.push("1"); return "b"; } };
const seen = [];
console.log(Reflect.apply(process.argv.length > 5 ? Array.prototype.at : Array.prototype.includes, like, ["b"]), seen.join());
