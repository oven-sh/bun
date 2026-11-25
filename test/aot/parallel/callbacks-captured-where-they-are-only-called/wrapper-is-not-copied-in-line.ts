type Visit = (x: number) => number;

const kept: Visit[] = [];
const log: string[] = [];

function each(list: number[], f: Visit): number {
    let t = 0;
    for (let i = 0; i < list.length; i++) t += f(list[i]);
    return t;
}

function large(list: number[], mode: number, f: Visit): number {
    let t = 0;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < list.length; i++) {
        const x = list[i];
        if (x < low) low = x;
        if (x > high) high = x;
    }
    switch (mode % 6) {
        case 0:
            t = each(list, f);
            break;
        case 1:
            t = each(list, x => f(x) + 1);
            break;
        case 2: {
            const floor = low;
            t = each(list, x => (x > floor ? f(x) : 0));
            break;
        }
        case 3:
            for (let i = 0; i < list.length; i++) {
                const weight = i + 1;
                t += each(list, x => f(x) * weight);
            }
            break;
        case 4:
            kept.push(x => f(x) + high);
            t = kept.length;
            break;
        default:
            try {
                t = each(list, x => {
                    if (x === high) throw new Error("at " + f(x));
                    return f(x);
                });
            } catch (error) {
                log.push((error as Error).message);
                t = -1;
            }
    }
    if (t > 1e9) log.push("large " + t);
    const spread = high - low;
    return t * 2 + spread + f(spread);
}

function maker(list: number[], mode: number, k: number): number {
    const t = large(list, mode, x => x * k + mode);
    return t + 1;
}

function overwriteStack(depth: number, salt: number): number {
    if (!depth) return salt;
    const a = large([1, 2], depth, x => x + depth + salt);
    const b = overwriteStack(depth - 1, salt + 1);
    return (a + b) % 1000003;
}

let sum = 0;
for (let i = 0; i < 600; i++) {
    sum += maker([i, i + 2, i + 1], i, (i % 7) + 1);
    if (i % 100 === 99) Bun.gc(true);
}
const keptByMakers = kept.length;
Bun.gc(true);
console.log(overwriteStack(1200, 31));
Bun.gc(true);

let sumOfKept = 0;
for (let i = 0; i < kept.length; i++) sumOfKept += kept[i](i % 13);
console.log(sum, keptByMakers, kept.length, sumOfKept, new Set(kept).size);
console.log(log.length, log[0], log[log.length - 1]);
console.log(kept[0](1), kept[1](1), kept[keptByMakers - 1](1), kept[kept.length - 1](1));
