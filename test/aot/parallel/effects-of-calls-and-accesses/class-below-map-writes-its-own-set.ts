// a class below Map writes its own `set`, which the super call enters for each pair and which writes a variable that the constructor reads on both sides
let sets = 0;
class M extends Map<string, number> {
    seen: string;
    constructor(pairs: [string, number][]) { const before = sets; super(pairs); this.seen = before + " " + sets; }
    set(key: string, value: number) { sets = sets + 1; return super.set(key, value * 2); }
}
function deed(pairs: [string, number][]) { const m = new M(pairs); return m.seen + " " + m.size + " " + String(m.get("a")); }
console.log(deed([]));
console.log(deed([["a", 1], ["b", 2]]));
let all = "";
for (let i = 0; i < 3; i++) all += deed([["a", i]]) + ";";
console.log(all);
