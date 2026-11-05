const like = { get length() { seen.push("length"); return 2; }, get 0() { seen.push("0"); return "a"; }, get 1() { seen.push("1"); return "b"; } };
const seen = [];
const tagged = { get [Symbol.toStringTag]() { seen.push("tag"); return "Made"; } };
const say = process.argv.length > 5 ? Object.prototype.valueOf : Object.prototype.toString;
console.log(String(say.call(tagged)), seen.join());
