type Callback = (x: number) => number;

const kept: Callback[] = [];

function walk(depth: number, list: number[]): number {
    let total = depth;
    list.forEach(x => {
        total += x;
        if (depth > 0)
            total += walk(depth - 1, list);
        return total;
    });
    return total;
}

const list: number[] = [1, 2];
let checksum = 0;
for (let run = 0; run < 1000; run++) {
    if (run === 503) {
        (list as any).forEach = function (this: number[], callback: Callback) {
            kept.push(callback);
            for (let index = 0; index < this.length; index++)
                callback(this[index]);
        };
    }
    if (run === 504)
        delete (list as any).forEach;
    checksum = (checksum * 31 + walk(run % 4, list)) % 1000003;
}

console.log(checksum, kept.length);
const seen: number[] = [];
for (const callback of kept)
    seen.push(callback(0));
console.log(seen.join(" "));
console.log(walk(3, list), walk(0, list));
const seenAgain: number[] = [];
for (const callback of kept)
    seenAgain.push(callback(0));
console.log(seenAgain.join(" "));
