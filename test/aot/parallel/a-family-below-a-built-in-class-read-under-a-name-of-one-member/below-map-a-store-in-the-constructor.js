class Base extends Map { base() { return "base"; } }
class One extends Base { one() { return 1; } }
class Two extends Base { two() { return 2; } }
class Sub extends Two { constructor(...a) { super(...a); this.tally = "stored"; } }
class Three extends Base { three() { return 3; } }
class Four extends Three { four() { return 4; } }
class Five extends Base { five() { return 5; } }
const all = [new One(), new Two(), new Sub(), new Three(), new Four(), new Five()];
function pick(i) { return all[i % all.length]; }
let texts = 0, functions = 0, absent = 0, said = "";
for (let i = 0; i < 12; i++) { const got = pick(i).tally; if (typeof got === "string") { texts++; said += got; } else if (typeof got === "function") functions++; else if (got === undefined) absent++; }
console.log(texts, functions, absent, said);
