// The second name is given in a turn and comes round, or the object is reached through another fresh object that goes round.
function givenInFirstTurn(n) { const acc = { n: 0 }; let k = null; for (let i = 0; i < n; i++) { if (!k) k = acc; k.n += i; } return acc.n; }
function givenInLastTurn(n) { const acc = { n: 0 }; let k = { n: -1 }; for (let i = 0; i < n; i++) { k.n += 10; if (i === n - 2) k = acc; } return acc.n; }
function throughHolder(n) { const acc = { n: 0 }; const holder = { inner: acc }; let k = holder; for (let i = 0; i < n; i++) { k.inner.n += i; k = k; } return acc.n; }
function throughTwoHolders(n) { const acc = { n: 0 }; const holder = { inner: { inner: acc } }; let k = holder; for (let i = 0; i < n; i++) { k.inner.inner.n += i; k = k; } return acc.n; }
function throughList(n) { const acc = { n: 0 }; const holder = [acc]; let k = holder; for (let i = 0; i < n; i++) { k[0].n += i; k = k; } return acc.n; }
function downAChain(n) { const last = { n: 0, next: null }; const first = { n: 0, next: { n: 0, next: last } }; let k = first; while (k) { k.n += n; k = k.next; } return first.n + ":" + first.next.n + ":" + last.n; }
function roundARing(n) { const a = { n: 0, next: null }, b = { n: 0, next: a }; a.next = b; let k = a; for (let i = 0; i < n; i++) { k.n += i; k = k.next; } return a.n + ":" + b.n; }
function holderReplaced(n) { const acc = { n: 0 }, other = { n: 100 }; const holder = { inner: acc }; let k = holder; for (let i = 0; i < n; i++) { k.inner = i & 1 ? acc : other; k.inner.n += i; k = k; } return acc.n + ":" + other.n + ":" + (holder.inner === acc); }
function twoLoopsInARow(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.n += i; k = k; } const between = acc.n; for (let i = 0; i < n; i++) { k.n += i; k = k; } return between + ":" + acc.n; }
function secondLoopOnly(n) { const acc = { n: 0 }; for (let i = 0; i < n; i++) acc.n += 1; let k = acc; for (let i = 0; i < n; i++) { k.n += i; k = k; } return acc.n; }
console.log(givenInFirstTurn(0), givenInFirstTurn(6), givenInLastTurn(6), throughHolder(6), throughTwoHolders(6), throughList(6), downAChain(3), roundARing(6), holderReplaced(6), twoLoopsInARow(6), secondLoopOnly(6));
let last = ""; for (let r = 0; r < 300; r++) last = [givenInFirstTurn(6), givenInLastTurn(6), throughHolder(6), throughTwoHolders(6), throughList(6), downAChain(3), roundARing(6), holderReplaced(6), twoLoopsInARow(6), secondLoopOnly(6)].join(" ");
console.log(last);
