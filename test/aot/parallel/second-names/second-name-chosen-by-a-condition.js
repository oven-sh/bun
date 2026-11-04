// `k = c ? acc : other`: the name behind the join is one of two fresh objects.
function chosen(c, v) { const acc = { n: 0 }, other = { n: 100 }; const k = c ? acc : other; k.n += v; return acc.n + ":" + other.n; }
function chosenInLoop(n) { const acc = { n: 0 }, other = { n: 100 }; for (let i = 0; i < n; i++) { const k = i & 1 ? acc : other; k.n += i; } return acc.n + ":" + other.n; }
function chosenRoundLoop(n) { const acc = { n: 0 }, other = { n: 100 }; let k = acc; for (let i = 0; i < n; i++) { k.n += i; k = i & 1 ? acc : other; } return acc.n + ":" + other.n; }
function chosenOrNull(c, v) { const acc = { n: 0 }; const k = c ? acc : null; if (k) k.n = v; return acc.n; }
function chosenByOr(given, v) { const acc = { n: 0 }; const k = given || acc; k.n = v; return acc.n; }
function chosenByNullish(given, v) { const acc = { n: 0 }; const k = given ?? acc; k.n = v; return acc.n; }
console.log(chosen(true, 3), chosen(false, 3), chosenInLoop(6), chosenRoundLoop(6), chosenOrNull(true, 4), chosenOrNull(false, 4), chosenByOr(null, 5), chosenByOr({ n: 1 }, 5), chosenByNullish(undefined, 6), chosenByNullish({ n: 1 }, 6));
let last = ""; for (let r = 0; r < 300; r++) last = [chosen(r & 1, 3), chosenInLoop(6), chosenRoundLoop(6), chosenOrNull(r & 1, 4), chosenByOr(r & 1 ? null : { n: 1 }, 5), chosenByNullish(r & 1 ? undefined : { n: 1 }, 6)].join(" ");
console.log(last);
