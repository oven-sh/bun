"use strict";
const kinds = [
    i => i * 3 + 1,
    i => i + 0.25,
    i => (i % 3 ? "t" + i : { at: i }),
];
function read(x) { return typeof x === "object" ? x.at * 7 : typeof x === "string" ? x.length + Number(x.slice(1)) : x; }
function sumOf(list) {
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
        if (!(i in list)) return "a hole at " + i;
        sum += read(list[i]) * (i + 1);
    }
    if (list[list.length] !== undefined || list.length in list) return "something behind the end";
    return sum;
}
function pushed(make, n) { const list = []; for (let i = 0; i < n; i++) list.push(make(i)); return list; }
function storedAtTheLength(make, n) { const list = []; for (let i = 0; i < n; i++) list[list.length] = make(i); return list; }
function bornWithOne(make, n) { const list = [make(0)]; for (let i = 1; i < n; i++) list.push(make(i)); return list; }
function appended(make, n, step) {
    const list = [];
    for (let i = 0; i < n; i += step) {
        const more = [];
        for (let j = i; j < i + step && j < n; j++) more.push(make(j));
        list.push(...more);
    }
    return list;
}
const said = [];
for (let k = 0; k < kinds.length; k++) {
    let all = 0;
    for (let n = 0; n <= 70; n++) {
        const a = sumOf(pushed(kinds[k], n)), b = sumOf(storedAtTheLength(kinds[k], n)), c = n ? sumOf(bornWithOne(kinds[k], n)) : a;
        if (a !== b || a !== c || typeof a !== "number") said.push("kind " + k + " length " + n + ": " + a + " | " + b + " | " + c);
        for (let step = 1; step <= 7; step++) {
            const d = sumOf(appended(kinds[k], n, step));
            if (d !== a) said.push("kind " + k + " length " + n + " by " + step + ": " + a + " | " + d);
        }
        all += a;
    }
    said.push(all);
}
const kept = [];
for (let n = 0; n < 3000; n++) kept.push(pushed(kinds[n % 3], n % 67));
let whole = 0;
for (const list of kept) whole += sumOf(list);
said.push(whole);
const turns = pushed(kinds[0], 5);
turns.push(0.5);
for (let i = 0; i < 12; i++) turns.push(i);
turns.push("text");
for (let i = 0; i < 30; i++) turns.push(i + 0.5);
said.push(turns.length, turns[5], turns[18], turns[48], 49 in turns);
console.log(said.join(" "));
