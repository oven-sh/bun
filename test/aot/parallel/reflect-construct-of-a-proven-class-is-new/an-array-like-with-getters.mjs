class P { constructor(x, y) { log.push("made"); this.t = x + "," + y; } }
const log = [];
const like = { get length() { log.push("length"); return 2; }, get 0() { log.push("0"); return "a"; }, get 1() { log.push("1"); return "b"; } };
console.log(Reflect.construct(P, like).t, log.join());
