const given = JSON.parse('[1,"a",null,{"k":2},0.5,true,false]');
let last, count = 0;
function risky(v) { if (typeof v === "string") throw v; return v; }
function read(s) { for (let at = 0; at < s.length; at++) { let x; try { x = risky(s[at]); } catch (e) { x = e; } if (x === true || x === false) continue; last = x; count++; } return count; }

function show() { return [last].map(v => typeof v).join(); }

console.log(read(given), show(), count);
