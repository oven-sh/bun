type Callback = (x: number) => number;
const kept: { callback: Callback, total: number }[] = [];
const keeper = { each(callback: Callback): void { callback(1); kept.push({ callback, total: callback(2) }); } };
const caller = { each(callback: Callback): void { callback(1); callback(2); } };
const buses: any[] = (JSON.parse("[0,1,0,0,1,2]") as number[]).map(n => n === 2 ? undefined : n ? keeper : caller);
function sum(receiver: any, run: number): number {
    let total = run;
    function add(x: number): void { total += x; }
    add(1);
    if (receiver)
        receiver.each((x: number) => { total += x; return total; });
    return total;
}
let checksum = 0;
for (let run = 0; run < 600; run++)
    checksum = (checksum * 31 + sum(buses[run % buses.length], run)) % 1000003;
let wrong = 0;
for (const entry of kept) {
    if (entry.callback(0) !== entry.total)
        wrong++;
}
console.log(checksum, kept.length, wrong, new Set(kept.map(entry => entry.callback)).size);
