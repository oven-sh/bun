function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
let log = '';
function key(k) { log += k; return k; }
function make(x) { return { a: x ? 1 : 2, [key('k')]: key('v'), b: x ? 3 : 4 }; }
console.log(show(make(true)), log);
