// A place names the Structure of what it met by a number, and the number of a Structure that has died is given out again.
function valueOf(o) { return o.value; }
function make(round, i) { const o = {}; o["a" + round] = 1; if (round % 2) o["b" + round] = 2; o.value = round * 1000 + i; return o; }
let wrong = 0;
for (let round = 0; round < 60; round++) {
    for (let i = 0; i < 200; i++) if (valueOf(make(round, i)) !== round * 1000 + i) wrong++;
    Bun.gc(true);
}
const proto = round => { const p = {}; p["c" + round] = 1; p.value = "p" + round; return p; };
for (let round = 0; round < 60; round++) {
    const p = proto(round);
    for (let i = 0; i < 200; i++) if (valueOf(Object.create(p)) !== "p" + round) wrong++;
    Bun.gc(true);
}
console.log(wrong);
