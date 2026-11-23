// Flags: --aot-harden=proof-checks
function skip0() { for (let i = 0; i < 8; i++) {} }
function skip1() { for (let i = 0; i < 8; i++) {} }
function halve(a) { for (let i = 0; i < 8; i++) { const at = a[i] & 7; const t = a[at] & 0.5; a[at] = t; } }
function skip2() { for (let i = 0; i < 8; i++) {} }
function skip3() { for (let i = 0; i < 8; i++) {} }
const runs = [skip0, skip1, halve, skip2, skip3];
globalThis.place = 2;
const view = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
runs[place](view);
console.log(view.join());
