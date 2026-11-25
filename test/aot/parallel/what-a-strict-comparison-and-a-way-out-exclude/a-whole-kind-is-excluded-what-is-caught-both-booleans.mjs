const given = JSON.parse('[1,"a",null,{"k":2},0.5,true,false]');
let last, count = 0;
function read(s) { for (let at = 0; at < s.length; at++) { try { throw s[at]; } catch (x) { if (x === true || x === false) continue; last = x; count++; } } return count; }

function show() { return [last].map(v => typeof v).join(); }

console.log(read(given), show(), count);
