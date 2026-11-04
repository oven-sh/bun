// `let k = other; if (c) k = acc;`: the join behind the if gives the fresh object a second name.
function behindIf(c, v) { const acc = { n: 0 }, other = { n: 100 }; let k = other; if (c) k = acc; k.n += v; return acc.n + ":" + other.n; }
function behindIfElse(c, v) { const acc = { n: 0 }; let k; if (c) { k = acc; } else { k = { n: 7 }; } k.n += v; return acc.n + ":" + k.n; }
function behindSwitch(c, v) { const a = { n: 0 }, b = { n: 10 }, d = { n: 20 }; let k; switch (c) { case 0: k = a; break; case 1: k = b; break; default: k = d; } k.n += v; return a.n + ":" + b.n + ":" + d.n; }
function behindTry(c, v) { const acc = { n: 0 }; let k = { n: 9 }; try { if (c) throw acc; } catch (thrown) { k = thrown; } k.n += v; return acc.n + ":" + k.n; }
function sameOnBothWays(c, v) { const acc = { n: 0 }; let k; if (c) k = acc; else k = acc; k.n += v; return acc.n; }
console.log(behindIf(true, 3), behindIf(false, 3), behindIfElse(true, 4), behindIfElse(false, 4), behindSwitch(0, 5), behindSwitch(1, 5), behindSwitch(2, 5), behindTry(true, 6), behindTry(false, 6), sameOnBothWays(true, 7), sameOnBothWays(false, 7));
let last = ""; for (let r = 0; r < 300; r++) last = [behindIf(r & 1, 3), behindIfElse(r & 1, 4), behindSwitch(r % 3, 5), behindTry(r & 1, 6), sameOnBothWays(r & 1, 7)].join(" ");
console.log(last);
