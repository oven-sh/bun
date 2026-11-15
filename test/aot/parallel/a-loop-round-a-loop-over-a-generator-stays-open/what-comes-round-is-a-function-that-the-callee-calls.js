function* pair(first, second) { yield first; yield second; }
function* pairByLoop(first, second) { for (let at = 0; at < 2; at++) yield at ? second : first; }
function run(callback, box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return callback(box) + work; }
function rounds() {
    const box = { count: 5 }, quiet = (held) => held.count, loud = (held) => { held.count = held.count + 1; return 0; };
    let total = 0, callback = quiet;
    for (let round = 0; round < 300; round++) { for (const value of pair(1, 2)) total += value; const before = box.count; total += run(callback, box); total += box.count - before; callback = loud; }
    return total;
}
function roundsToo() {
    const box = { count: 5 }, quiet = (held) => held.count, loud = (held) => { held.count = held.count + 1; return 0; };
    let total = 0, callback = quiet;
    for (let round = 0; round < 300; round++) { for (const value of pairByLoop(1, 2)) total += value; const before = box.count; total += run(callback, box); total += box.count - before; callback = loud; }
    return total;
}
console.log(rounds(), roundsToo());
