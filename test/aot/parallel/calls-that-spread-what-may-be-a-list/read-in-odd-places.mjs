const lists = JSON.parse('[[1,2],[3,4],"ab",[5]]');
lists.push(new Set([6, 7]));
function add(a, b) { return a + "" + b; }
function nothing(a, b) { }
function boom(a, b) { throw "t" + a + b; }
function wrap(xs) { return add(...xs); }
function tails(ls) { let s = ""; for (let i = 0; i < ls.length; i++) s += wrap(ls[i]) + ","; return s; }
function asTest(ls) { let n = 0; for (let i = 0; i < ls.length; i++) { if (add(...ls[i])) n++; } return n; }
function whileTest(ls) { let i = 0; while (i < ls.length && add(...ls[i]) !== "5undefined") i++; return i; }
function voids(ls) { let s = ""; for (let i = 0; i < ls.length; i++) s += nothing(...ls[i]) + ","; return s; }
function caught(ls) { let s = ""; for (let i = 0; i < ls.length; i++) { let r = "-"; try { r = boom(...ls[i]); } catch (e) { r = e + ls[i].length; } finally { s += r + ","; } } return s; }
function kept(ls) { const fs = []; for (let i = 0; i < ls.length; i++) { const r = add(...ls[i]); fs.push(() => r); } return fs.map(f => f()).join(); }
async function waits(ls) { let s = ""; for (let i = 0; i < ls.length; i++) s += (await add(...ls[i])) + ","; return s; }
function* steps(ls) { for (let i = 0; i < ls.length; i++) { const got = yield add(...ls[i]); if (got) return got; } }
console.log(`SAID ${tails(lists)} ${asTest(lists)} ${whileTest(lists)} ${voids(lists)} ${caught(lists)} ${kept(lists)} ${await waits(lists)} ${[...steps(lists)].join()}`);
