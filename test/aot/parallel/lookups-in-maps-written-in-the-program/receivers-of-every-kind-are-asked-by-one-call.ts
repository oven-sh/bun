class Loud extends Map<string, number> { get(k: string) { return (super.get(k) ?? 0) + 100; } }
const im = new Map([["aa", 1], ["bb", 2]]), w = new WeakMap<object, number>(), o = {}; w.set(o, 7);
const l = new Loud([["aa", 5]]), look = (x: any, k: any) => x.get(k); let out = "";
for (let t = 0; t < 2; t++) out += [look(im, "aa"), look(im, "bb"), look(im, 1), look(im, null), look(w, o), look(w, "aa"), look(l, "aa"), look({ get: (k: string) => k + "!" }, "aa"), Map.prototype.get.call(im, "bb"), ["aa", "zz"].map(im.get, im)].join("|") + ";";
console.log(out);
