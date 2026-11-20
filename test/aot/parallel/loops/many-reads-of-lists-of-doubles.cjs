"use strict";
// STATISTIC: LoopsUnswitched >= 1
// Loops that read several elements off the same lists of numbers: one version of each knows that the lists hold doubles.
const kernels = {
    apart(first, second, many) {
        let sum = 0;
        for (let at = 0; at < many; at++) {
            const along = first[0] * at - second[0], aside = first[1] * at - second[1], above = first[2] - second[2] * at;
            sum += along * along + aside * aside + above * above;
        }
        return sum;
    },
    corners(first, second, many) {
        let sum = 0;
        for (let at = 0; at < many; at++) {
            first[0] += second[3] * 0.5;
            first[1] -= second[2] * 0.25;
            first[2] += first[0] - first[1];
            sum += first[2] / (at + 1);
        }
        return sum;
    },
    wave(first, second, many) {
        let last = 0;
        for (let at = 1; at + 1 < many; at++)
            last += first[at - 1] - 2 * first[at] + first[at + 1] + second[at];
        return last;
    },
    turned(first, second, many) {
        for (let at = 0; at < many; at++) {
            const kept = first[0];
            first[0] = first[0] * 0.8 - first[1] * 0.6;
            first[1] = kept * 0.6 + first[1] * 0.8 + second[0];
        }
        return first[0] + first[1];
    },
};
const lists = {
    doubles: () => [1.5, -2.25, 3.125, 0.5, 8.5, 9.75, 1.25, 2.5, 3.5, 4.5],
    whole: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    both: () => [1, 2.5, 3, 4.5, 5, 6, 7, 8, 9, 10],
    boxed: () => { const list = [1.5, "x", 2, 3, 4, 5, 6, 7, 8, 9]; list[1] = 2.5; return list; },
    holes: () => [1.5, 2.5, , 4.5, 5.5, 6, 7, 8, 9, 10],
    short: () => [1.5, 2.5],
    none: () => [],
    texts: () => ["1", "2", "3", "4", 5, 6, 7, 8, 9, 10],
    missing: () => [undefined, null, true, 4, 5, 6, 7, 8, 9, 10],
    view: () => Float64Array.of(1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5),
    bytes: () => Uint8Array.of(250, 251, 252, 253, 254, 255, 1, 2, 3, 4),
    inherits: () => Object.setPrototypeOf([1.5, 2.5, , 4.5, 5, 6, 7, 8, 9, 10], { __proto__: Array.prototype, 2: 7 }),
    like: () => ({ 0: 1.5, 1: 2.5, 2: 3.5, 3: 4.5, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, length: 10 }),
    nan: () => [NaN, -0, Infinity, -Infinity, 0, 1, 2, 3, 4, 5],
};
const said = value => (typeof value === "number" ? (Object.is(value, -0) ? "-0" : value.toPrecision(9)) : typeof value + " " + String(value).slice(0, 40));
for (const [name, run] of Object.entries(kernels)) {
    for (let round = 0; round < 2; round++) {
        for (const [one, first] of Object.entries(lists)) {
            const line = [];
            for (const [two, second] of Object.entries(lists)) {
                const list = first();
                let end;
                try {
                    end = said(run(list, second(), 10));
                } catch (error) {
                    end = error.constructor.name;
                }
                line.push(end + (Array.isArray(list) ? list.length : ""));
            }
            console.log(name, one, line.join(" "));
        }
        const same = lists.doubles();
        console.log(name, said(run(same, same, 40)), same.map(said).join(" "));
    }
}
