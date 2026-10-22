// arms that are the same to the letter, but for where control goes behind them or what a variable of the same name holds
function a(k) { let r = 0; if (k === 0) { r = 1.5; log.push("x"); } else if (k === 1) { r = 1.5; log.push("x"); } else { r = 2.5; log.push("x"); } return r; }
function b(k) { for (let i = 0; i < 3; i++) { if (k === 0) { log.push(i); continue; } if (k === 1) { log.push(i); break; } log.push(i); return "returned"; } return "fell"; }
function c(k) { outer: for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { if (k === 0) { log.push(i + j); continue outer; } if (k === 1) { log.push(i + j); break outer; } log.push(i + j); } return log.length; }
function d(k) { try { if (k === 0) { log.push("t"); throw 1.5; } if (k === 1) { log.push("t"); throw 2.5; } log.push("t"); } catch (e) { return e; } finally { log.push("f"); } return "none"; }
function e(k) { { let v = 1.5; if (k === 0) return v; } { let v = 2.5; if (k === 1) return v; } { let v = -0; return 1 / v; } }
var log = [];
for (const f of [a, b, c, d, e]) for (let k = 0; k < 3; k++) { log = []; console.log(f.name, k, String(f(k)), log.join()); }
