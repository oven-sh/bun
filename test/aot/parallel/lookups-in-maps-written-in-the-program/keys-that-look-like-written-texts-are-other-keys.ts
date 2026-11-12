const m = new Map<any, any>([["1", "one"], ["", "empty"], ["0", "zero"], ["NaN", "nan"]]), r: any[] = [];
for (const k of [1, "1", "", 0, -0, NaN, 1n, null, undefined, "NaN", "0"]) r.push(m.get(k));
console.log(r.join("|"));
const twice = new Map([["k", "first"], ["q", "x"], ["k", "last"]]); console.log(twice.get("k"), twice.get("q"), twice.size, [...twice.keys()].join(), twice.get("k"));
const grown = new Map([["aa", 1], ["bb", 2]]); let s = 0; for (let i = 0; i < 4; i++) { s += grown.get("aa")! * 10 + grown.size; if (i === 1) grown.set("cc", 5); } console.log(s);
