// The try stands in the body of the module, and a function of the module reads the name too. So many names are stored to under each try that they are kept in fields.
function give(value: number, fails: boolean): number { if (fails) throw value; return value; }
let shown = 0, alone = 0;
function show(): number { return shown; }
let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0, a8 = 0, a9 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0, a14 = 0, a15 = 0, a16 = 0, a17 = 0, a18 = 0, a19 = 0, a20 = 0, a21 = 0, a22 = 0, a23 = 0;
try { a0 = a1 = a2 = a3 = a4 = a5 = a6 = a7 = a8 = a9 = a10 = a11 = a12 = a13 = a14 = a15 = a16 = a17 = a18 = a19 = a20 = a21 = a22 = a23 = 1; shown = give(1, false); alone = give(2, false); shown = give(3, true); alone = 4; } catch (thrown) { console.log("caught", thrown, shown, alone, show()); }
console.log(shown, alone, show());
