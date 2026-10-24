// An async function that was started earlier stores to a variable of its creator while the creator awaits. What the creator reads after the await is the new value.
const later = () => new Promise(resolve => setTimeout(resolve, 0));
async function afterATimer() { let n = 1; const other = (async () => { await later(); n = 2; })(); const a = n; await other; return [a, n].join(); }
async function afterOneTurn() { let n = 1; const other = (async () => { await null; n = 2; })(); const a = n; await other; return [a, n].join(); }
async function storeBeforeTheAwait() { let n = 1; const other = (async () => { await null; n = 2; })(); n = 5; await other; return n; }
console.log(await afterATimer(), await afterOneTurn(), await storeBeforeTheAwait());
console.log(await afterATimer(), await afterOneTurn(), await storeBeforeTheAwait());
