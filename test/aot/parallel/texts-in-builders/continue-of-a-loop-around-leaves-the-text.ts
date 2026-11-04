// the loop of the growing text is left by `continue` and by `break` of the loop around it, with the text dead, and with the text handed on
function dropped(n: number, stop: number) { let out = ""; outer: for (let i = 0; i < n; i++) { let s = ""; for (let j = 0; j < n; j++) { s += "x" + j; if (j === stop + i) continue outer; } out = out + s + ";"; } return out; }
function carried(n: number, stop: number) { let last = "none"; outer: for (let i = 0; i < n; i++) { let s = "r" + i; for (let j = 0; j < n; j++) { s += "x" + j; if (j === stop) { last = s; continue outer; } } last = "whole " + s; } return last; }
function broken(n: number, stop: number) { let last = "none"; outer: for (let i = 0; i < n; i++) { let s = "r" + i; for (let j = 0; j < n; j++) { s += "x" + j; if (i + j === stop) { last = s; break outer; } } } return last; }
console.log(JSON.stringify(dropped(0, 0)), dropped(3, 9), dropped(4, 1), JSON.stringify(dropped(4, 0)));
console.log(carried(0, 0), carried(3, 9), carried(3, 1), carried(3, 0));
console.log(broken(0, 0), broken(3, 9), broken(3, 3), broken(3, 0));
let lengths = 0;
for (let turn = 0; turn < 40; turn++) lengths += dropped(turn % 6, 2).length + carried(turn % 6, 2).length + broken(turn % 6, 4).length;
console.log(lengths);
