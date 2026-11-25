const lists = JSON.parse("[[1,0,3],[4,5],[6],[7,8,9,10]]"), turns = JSON.parse("2");
lists[0][1] = undefined;
function late(a, b = (lists[0].length = 0, 20), c) { return a + "/" + b + "/" + c; }
function writes(a, b) { lists[1][1] = 700; return a + "/" + b; }
function few(a, b = "d", c) { return a + "/" + b + "/" + c; }
function runLate(xs, n) { const out = []; for (let i = 0; i < n; i++) out[i] = late(...xs); return out.join(" "); }
function runWrites(xs, n) { const out = []; for (let i = 0; i < n; i++) out[i] = writes(...xs); return out.join(" "); }
function runFew(xs, n) { const out = []; for (let i = 0; i < n; i++) out[i] = few(...xs); return out.join(" "); }
console.log(`SAID ${runLate(lists[0], turns)} | ${runWrites(lists[1], turns)} | ${runFew(lists[2], turns)} | ${runFew(lists[3], turns)} | ${runFew(new Set(lists[3]), turns)} | ${runFew("xy", turns)}`);
