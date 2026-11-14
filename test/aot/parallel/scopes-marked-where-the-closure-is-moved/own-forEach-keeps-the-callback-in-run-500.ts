type Callback = (x: number) => number;

const kept: Callback[] = [];

function sum(list: number[], run: number): number {
    let total = run;
    list.forEach(x => { total += x; return total; });
    return total;
}

const list: number[] = [1, 2, 3, 4];
let checksum = 0;
for (let run = 0; run < 1000; run++) {
    if (run === 500)
        (list as any).forEach = function (callback: Callback) { kept.push(callback); };
    if (run === 501)
        delete (list as any).forEach;
    checksum = (checksum * 31 + sum(list, run)) % 1000003;
}

console.log(checksum, kept.length);
console.log(kept[0](1), kept[0](10), kept[0](100));
console.log(sum(list, 7), kept[0](0), sum(list, 8), kept[0](0));
