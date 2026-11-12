const log = [];
function a(i) { const o = { v: i }; try { return o; } finally { log.push(o.v); o.v++; } }
function b(i) { const o = { v: i }, p = { v: -i }; try { throw o; } catch (e) { return e; } finally { log.push(p.v); } }
function c(i) { const o = { v: i }; try { return i; } finally { log.push(o); } }
console.log(a(1).v, b(2).v, c(3), log.length, log[2].v);
