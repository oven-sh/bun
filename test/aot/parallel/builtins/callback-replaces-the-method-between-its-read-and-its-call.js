// in a loop the callback that makes the operand lays another push on the list, takes it away again, changes what stands above the list, and makes it grow past its room
function gather(from, f) { const result = []; for (let i = 0; i < from.length; i++) result.push(f(from[i], result)); return result; }
const log = [];
function show(list) { return Array.prototype.join.call(list) + "/" + list.length; }
console.log(show(gather([1, 2, 3, 4], (x, r) => x)));
console.log(show(gather([1, 2, 3, 4], (x, r) => { if (x === 2) r.push = function (v) { log.push("own " + v); return 0; }; return x; })), log.join());
console.log(show(gather([1, 2, 3, 4], (x, r) => { if (x === 2) r.push = function (v) { log.push("own " + v); return 0; }; if (x === 4) delete r.push; return x; })), log.join());
console.log(show(gather([1, 2, 3, 4], (x, r) => { if (x === 3) Object.setPrototypeOf(r, { push(v) { log.push("above " + v); } }); return x; })), log.join());
console.log(show(gather([1, 2, 3], (x, r) => { for (let k = 0; k < 40; k++) r.push(-k); return x; })).length);
console.log(show(gather([1, 2, 3], (x, r) => { r.length = 0; return x; })));
try { gather([1, 2, 3], (x, r) => { if (x === 2) Object.freeze(r); return x; }); } catch (e) { console.log(e.name); }
