type Callback = (x: number) => number;

const kept: { callback: Callback, total: number }[] = [];
let calls = 0;

const bus: any = {
    each(callback: Callback): void {
        callback(1);
        const total = callback(2);
        if (++calls % 3 === 0)
            kept.push({ callback, total });
    },
};

function sum(receiver: any, run: number): number {
    let total = run;
    function add(x: number): void { total += x; }
    add(1);
    if (receiver)
        receiver.each((x: number) => { total += x; return total; });
    return total;
}

let checksum = 0;
for (let run = 0; run < 1000; run++)
    checksum = (checksum * 31 + sum(run % 5 === 4 ? undefined : bus, run)) % 1000003;

let wrong = 0;
let sumOfKept = 0;
for (const entry of kept) {
    const seen = entry.callback(0);
    if (seen !== entry.total)
        wrong++;
    sumOfKept += seen;
}
console.log(checksum, calls, kept.length, wrong, sumOfKept);

for (let index = 0; index < kept.length; index++)
    kept[index].callback(index);
let wrongAgain = 0;
for (let index = 0; index < kept.length; index++) {
    if (kept[index].callback(0) !== kept[index].total + index)
        wrongAgain++;
}
console.log(wrongAgain, sum(bus, 5), sum(undefined, 6), kept.length);
