// the loop of the growing text stands under a handler, or has one inside: what the handler reads is the text as it stood where the throw left
function refuse(i: number, stop: number) { if (i === stop) throw new RangeError("at " + i); return i; }
function around(n: number, stop: number) { let s = "<"; try { for (let i = 0; i < n; i++) s += "k" + refuse(i, stop); } catch (e) { return s + " caught " + (e as Error).message; } return s + ">"; }
function inside(n: number, stop: number) { let s = "<"; let caught = 0; for (let i = 0; i < n; i++) { try { s += "k" + refuse(i, stop); } catch { caught++; } } return s + "> " + caught; }
function insideAndGrows(n: number, stop: number) { let s = "<"; for (let i = 0; i < n; i++) { try { s += "a"; refuse(i, stop); s += "b"; } catch { s += "!"; } } return s; }
function finallyGrows(n: number, stop: number) { let s = "<"; try { for (let i = 0; i < n; i++) { try { s += "k" + refuse(i, stop); } finally { s += ";"; } } } catch { s += "caught"; } return s; }
function returnsUnderHandler(n: number, stop: number) { let s = "<"; for (let i = 0; i < n; i++) { try { s += "k" + i; if (i === stop) return s; refuse(i, stop + 9); } catch { continue; } } return s + ">"; }
console.log(around(0, 0), around(4, 9), around(4, 0), around(4, 2));
console.log(inside(0, 0), inside(4, 9), inside(4, 0), inside(4, 2));
console.log(insideAndGrows(0, 0), insideAndGrows(4, 9), insideAndGrows(4, 0), insideAndGrows(4, 2));
console.log(finallyGrows(0, 0), finallyGrows(4, 9), finallyGrows(4, 0), finallyGrows(4, 2));
console.log(returnsUnderHandler(0, 0), returnsUnderHandler(4, 9), returnsUnderHandler(4, 0), returnsUnderHandler(4, 2));
