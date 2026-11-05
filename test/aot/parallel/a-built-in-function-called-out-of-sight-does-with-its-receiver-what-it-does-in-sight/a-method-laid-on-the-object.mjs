const like = { get length() { seen.push("length"); return 2; }, get 0() { seen.push("0"); return "a"; }, get 1() { seen.push("1"); return "b"; } };
const seen = [];
like.every = Array.prototype.every;
const name = ["ev", "ery"].join("");
console.log(like[name](x => typeof x === "string"), seen.join());
