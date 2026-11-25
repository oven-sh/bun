const L = [];
async function twoLoops(h, s, n) { let t = s; try { t = h + s; for (let k = 0; k < n; k++) t += k; await null; t = t + "-"; for (let k = 0; k < n; k++) t += k; await null; } finally { L.push(String(t)); } }
async function throwsBehind(h, n) { let t = h; try { for (let k = 0; k < n; k++) t += k; await null; throw new RangeError(t); } catch (e) { L.push(e.message + "|" + t); } }
async function rejects(h, n) { let t = h; try { for (let k = 0; k < n; k++) t += k; await Promise.reject(new RangeError("no")); t += "never"; } catch (e) { L.push(e.message + "|" + t); } }
async function awaitsInLoopAround(h, n) { let t = h; try { for (let j = 0; j < 2; j++) { for (let k = 0; k < n; k++) t += k; await null; Bun.gc(true); t += "/"; } } finally { L.push(t); } }
function* yields(h, n) { let t = h; try { for (let k = 0; k < n; k++) t += k; yield t.length; for (let k = 0; k < n; k++) t += k; yield t; } finally { L.push("done " + t); } }
async function* both(h, n) { let t = h; try { for (let k = 0; k < n; k++) t += k; yield t; await null; for (let k = 0; k < n; k++) t += "x" + k; yield t; } finally { L.push("both " + t); } }
function may(x) { if (x === 2) throw new RangeError("two"); return x; }
async function throwsInLoop(h, n) { let t = h; try { for (let k = 0; k < n; k++) { t += may(k); } await null; t += "!"; } catch (e) { await null; L.push(e.message + "|" + t); } finally { L.push("f " + t); } }
async function oneInTheFrameAndOneOnTheHeap(h, n) { let a = h, b = ""; for (let k = 0; k < n; k++) b += k; try { for (let k = 0; k < n; k++) a += k; await null; Bun.gc(true); for (let k = 0; k < n; k++) b += "x"; a += b; await null; } finally { L.push(a + "|" + b); } }
async function sameTextBothWays(h, n) { let t = h; for (let k = 0; k < n; k++) t += k; await null; try { for (let k = 0; k < n; k++) t += "y"; await null; } finally { L.push(t); } for (let k = 0; k < n; k++) t += "z"; await null; L.push(t); }
await oneInTheFrameAndOneOnTheHeap("k", 3); await sameTextBothWays("l", 2);
await twoLoops("a", "b", 3); await throwsBehind("c", 3); await rejects("d", 3); await awaitsInLoopAround("e", 3);
for (const step of yields("f", 3)) L.push(String(step));
const left = yields("g", 2); left.next(); left.return(0);
for await (const step of both("h", 2)) { Bun.gc(true); L.push(step); }
await throwsInLoop("i", 2); await throwsInLoop("j", 4);
console.log(L.join("\n"));
