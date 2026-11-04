// the heap is collected between the store into a new promise and the read of what it holds
const log = [];
function wrap(n) {
    return Promise.resolve({ x: n, text: "value " + n });
}
async function early(n) {
    if (n >= 0)
        return { x: n, text: "early " + n };
    await undefined;
    return { x: -1, text: "late" };
}
function deed() {
    Bun.gc(true);
}
const kept = [];
for (let i = 0; i < 200; i++) {
    kept.push(wrap(i), early(i));
    if (i % 50 === 0)
        deed();
}
deed();
let sum = 0;
for (let i = 0; i < kept.length; i++) {
    const held = await kept[i];
    sum += held.x + held.text.length;
    if (i % 100 === 0)
        deed();
}
log.push(String(sum));
log.push((await kept[399]).text);
console.log(log.join("\n"));
