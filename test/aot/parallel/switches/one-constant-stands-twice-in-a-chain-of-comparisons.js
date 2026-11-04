// one constant stands twice in a chain of `if` and in a switch: the first comparison with it takes whatever equals it, and the second is never taken
function chain(k) { if (k === 1) return "first"; else if (k === 2) return "two"; else if (k === 1) return "second"; else if (k === 3) return "three"; return "rest"; }
function row(k) { return k === 7 || k === 8 || k === 7 || k === 9; }
function written(k) { switch (k) { case 1: return "first"; case 2: return "two"; case 3: return "three"; default: if (k === 1) return "second"; else if (k === 4) return "four"; return "rest"; } }
function deed(k) { return chain(k) + "," + row(k) + "," + written(k); }
let out = "";
for (let k = 0; k < 11; k++) out += deed(k) + " ";
console.log(out);
let last = "";
for (let turn = 0; turn < 400; turn++) last = deed(turn % 11);
console.log(last);
