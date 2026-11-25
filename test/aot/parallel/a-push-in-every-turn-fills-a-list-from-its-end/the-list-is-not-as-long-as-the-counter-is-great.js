function pushedInFront(n) { const m = n | 0, a = []; a.push(9); for (let i = 0; i < m; i++) a.push(i & 3); return a.join(""); }
function poppedInFront(n) { const m = n | 0, a = [5]; a.pop(); for (let i = 1; i < m; i++) a.push(i & 3); return a.join(""); }
function madeLonger(n) { const m = n | 0, a = []; a.length = 3; for (let i = 0; i < m; i++) a.push(i & 3); return a.length + ":" + (1 in a) + ":" + a[a.length - 1]; }
function counterStartsLate(n) { const m = n | 0, a = []; for (let i = 2; i < m; i++) a.push(i & 3); return a.join(""); }
function counterStartsEarly(n) { const m = n | 0, a = [7, 7]; for (let i = 0; i < m; i++) a.push(i & 3); return a.join(""); }
function counterGoesByTwo(n) { const m = n | 0, a = []; for (let i = 0; i < m; i += 2) a.push(i & 3); return a.join(""); }
const said = [];
for (const n of [0, 1, 2, 3, 6, 9, 20, 41]) said.push(pushedInFront(n), poppedInFront(n), madeLonger(n), counterStartsLate(n), counterStartsEarly(n), counterGoesByTwo(n));
console.log(said.join(" "));
