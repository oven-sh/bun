// Loops step a field of one object by name and under a key that is known at run time alone, through two names; the field is added behind the literal.
const key = JSON.parse('"vx"');
const lines = [];
const show = o => Object.keys(o).map(name => name + ":" + String(o[name])).join();
function stepThroughTwoNames(h, n) {
    let s = 0;
    const a = h.p, b = h.q;
    for (let j = 0; j < 2; j++) {
        for (let i = 0; i < n; i++) {
            b.vx -= 1;
            b[key] += 1;
            b[key] += 1;
            s += a.vx;
        }
    }
    return s;
}
function storeByName(h, n) {
    let s = 0;
    const a = h.p, b = h.q;
    for (let j = 0; j < 2; j++) {
        for (let i = 0; i < n; i++) {
            b.vx = i;
            a.x = i;
            a.m = 0;
            s += b[key];
        }
    }
    return s;
}
const kinds = [
    i => { const o = { x: i }; if (i) o.vx = i; o.m = 0; return o; },
    i => ({ x: i, vx: 1, m: 0, get id() { return this.vx; }, set vy(v) { this.m += v; } }),
    i => Object.create({ vx: 5, m: 1, x: i }),
];
for (let k = 0; k < kinds.length; k++) {
    for (let way = 0; way < 4; way++) {
        for (const n of [1, 4, 11]) {
            const x = kinds[k](2), y = way % 2 === 0 ? x : kinds[way === 1 ? k : (k + 1) % kinds.length](1);
            lines.push(stepThroughTwoNames({ p: x, q: y }, n), show(x), show(y));
            lines.push(storeByName({ p: x, q: y }, n), show(x), show(y));
        }
    }
}
const box = { p: null };
function stepWhatBoxHolds(a) { let s = 0; for (let i = 9; i > 0; i--) { a[key] += 1; box.p.x--; s += a["vx"]; } return s; }
for (const alike of [true, false, true]) {
    const x = kinds[0](2);
    box.p = alike ? x : kinds[0](1);
    lines.push(stepWhatBoxHolds(x), show(x), show(box.p));
}
console.log(lines.join("\n"));
