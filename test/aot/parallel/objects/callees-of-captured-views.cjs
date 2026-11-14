"use strict";
(function () {
    const buffer = new ArrayBuffer(4096);
    const bytes = new Uint8Array(buffer), words = new Int32Array(buffer), halves = new Uint16Array(buffer);
    for (let i = 0; i < 1024; i++)
        words[i] = i * 2654435761 | 0;
    let seen = 0;

    function matchLength(a, b) {
        let n = 0;
        while (n < 16 && (bytes[a + n & 4095] & 63) === (bytes[b + n & 4095] & 63))
            n = n + 1 | 0;
        return n;
    }
    function note(a, n) {
        halves[a & 2047] = n;
    }
    function readUnder(key) {
        seen++;
        return words[key];
    }
    function store(position, value) {
        words[position] = value;
    }

    function search(from, count) {
        let best = 0;
        for (let i = 0; i < count; i++) {
            const base = from + i * 4 | 0;
            const left = words[base >> 2] ^ words[base + 4 >> 2];
            const n = matchLength(base, left & 4095);
            note(base, n);
            best = best + n + (words[base + 8 >> 2] & 255) + words.length | 0;
        }
        return best;
    }
    console.log(search(0, 300), search(64, 300), search(1024, 500));

    // A key or a value that runs code.
    let stored = 0;
    const key = { toString() { words[7] = 77; return "7"; } };
    const value = { valueOf() { stored++; words[3] = 1000 + stored; return 5; } };
    Object.defineProperty(Int32Array.prototype, "named", { get() { words[9] = words[9] + 1 | 0; return 11; }, configurable: true });
    function around(k, v) {
        const before = words[3] + words[7] + words[9] | 0;
        const read = readUnder(k);
        store(5, v);
        return [before, read, words[3] + words[7] + words[9] | 0, words[5]].join();
    }
    for (const k of [1, 2.5, -1, "3", "named", key, undefined, NaN, 1e21])
        console.log(around(k, typeof k === "number" ? k : value));

    // The buffer leaves in front of a call.
    function total(position) {
        let sum = 0;
        for (let i = 0; i < 4; i++)
            sum = sum + (bytes[position + i] | 0) | 0;
        return sum;
    }
    function drain(times) {
        const sums = [];
        for (let i = 0; i < times; i++) {
            if (i === 3)
                buffer.transfer();
            sums.push(bytes.length, total(i), bytes[i]);
        }
        return sums.join();
    }
    console.log(drain(6), seen);
})();
