function* it() { for (const x of JSON.parse('[1,"a",null,{"k":2},0.5,true,false]')) yield x === 1 ? undefined : x; }
let last, count = 0;
function read(s) { for (const x of s) { if (x === true || x === false) continue; last = x; count++; } return count; }

function show() { return [last].map(v => typeof v).join(); }

console.log(read(it()), show(), count);
