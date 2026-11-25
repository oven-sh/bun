function ordered(flag) { var o = {}; if (flag) { o.p = 1; o.q = 2; } else { o.q = 3; o.p = 4; } return o; }
function half(flag) { var o = {}; if (flag) o.p = 1; o.q = 2; return o; }
function read(o) { return o.p + ":" + o.q + ":" + Object.keys(o).join(); }
let last = "";
for (let turn = 0; turn < 300; turn++) last = [read(ordered(turn % 2 === 0)), read(ordered(turn % 2 === 1)), read(half(turn % 2 === 0)), read(half(turn % 2 === 1))].join(" | ");
console.log(last);
