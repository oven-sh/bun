class Vec {
    constructor(d) { this.d = d; }
    mix(o) { this.d[2] -= o.d[1] * 0.5; this.d[2] += o.d[2] * 2; return this; }
}
const heirs = [new Vec(new (class extends Array {})(0.5, 1.5, 2.5)), new Vec([NaN, 1.5, 2.5])];
function run(v, w, n) {
    let s = 0;
    for (let i = 0; i < n; i++) {
        v.d[0] = i * 0.25;
        s = s * 0.5 + v.mix(w).d[1];
        s = s * 0.5 + v.mix(w).d[2];
        w.d[2] = i + 0.5;
    }
    return s;
}
for (const list of [[1n, 2n, 3n], [0.5, 1.5, 2.5], [1, 2, 3], ["a", "b", "c"], [{ x: 1 }, { x: 2 }, { x: 3 }], [, 1, 2]]) {
    const v = new Vec(list), w = new Vec([0.25, 0.5, 0.75]);
    for (let t = 0; t < 3; t++) {
        if (t === 1)
            w.d[2] = 7;
        try {
            console.log(run(v, w, 8));
        } catch (e) {
            console.log(e.message);
        }
        console.log(v.d.map(String).join(), w.d.join());
    }
}
console.log(heirs.length);
