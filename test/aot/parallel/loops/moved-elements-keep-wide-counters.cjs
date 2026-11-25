// A loop that only moves elements: its counters may lie past the greatest int32, or pass it.
"use strict";
function counted(target, source, start, n, m) {
    let at = start, s = 0;
    for (let i = 0; i < m; i++) { s ^= i; at++; }
    for (let j = 0; j < n; j++) target[at++] = source[j];
    return at + s * 0;
}
function counted2(target, source, start, n, m) {
    let at = start | 0, s = 0;
    for (let i = 0; i < m; i++) { s ^= source[i & 3]; at++; }
    for (let j = 0; j < n; j++) target[at++] = source[j];
    return at;
}
function counted3(target, source, start, n, m) {
    let at = start | 0;
    for (let i = 0; i < m; i++) at++;
    for (let j = 0; j < n; j++) { target[at] = target[at - 2]; at++; }
    return at;
}
function counted4(target, start, n, m) {
    let at = start | 0;
    for (let i = 0; i < m; i++) at += 3;
    for (let j = 0; j < n; j++) target[at++] = 5;
    return at;
}
function counted5(target, source, start, n) {
    let at = (start | 0) + 1000;
    for (let j = 0; j < n; j++) target[at++] = source[j];
    return at;
}
function counted6(target, source, start, n) {
    const at = (start | 0) + 1000;
    const end = at + n;
    for (let j = at; j < end; j++) target[j] = source[j];
    return end;
}
const say = (name, at, o) => console.log(name, at, Object.keys(o).length, Object.keys(o).slice(0, 3).join(), Object.keys(o).slice(-3).join());
const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (const start of [0, 2147483600, 2147483640, 2147483647, 5]) {
    for (const make of [() => ({}), () => [], () => [9, 8, 7]]) {
        let o;
        o = make(); say("counted", counted(o, source, start, 8, 20), o);
        o = make(); say("counted2", counted2(o, source, start, 8, 20), o);
        o = make(); say("counted3", counted3(o, source, start, 8, 20), o);
        o = make(); say("counted4", counted4(o, start, 8, 20), o);
        o = make(); say("counted5", counted5(o, source, start, 8), o);
        o = make(); say("counted6", counted6(o, source, start, 8), o);
    }
}
function beside(target, source, n) {
    let other = 2147483640;
    for (let j = 0; j < n; j++, other++) target[j] = source[j];
    return other;
}
function lower(target, source, start, distance, n) {
    let at = start | 0;
    for (let j = 0; j < n; j++) { target[at - distance] = source[j]; at++; }
    return at;
}
function downward(target, source, start, n) {
    let at = (start | 0) - 1000;
    for (let j = n; j--;) { target[j] = source[j]; }
    return at;
}
for (const make of [() => [], () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]]) {
    let o = make(); say("beside", beside(o, source, 12), o);
    o = make(); say("lower", lower(o, source, 2147483640, 2147483640, 12), o);
    o = make(); say("lower", lower(o, source, 5, 5, 12), o);
    o = make(); say("downward", downward(o, source, -2147483640, 8), o);
}
