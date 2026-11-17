// Date.now is written over by a function in a variable, later by another one.
const was = Date.now;
var ticks = 0;
function now() { return ++ticks * 10; }
function install(clock) { Date.now = clock; }
function spans(n) { let last = Date.now(), s = 0; for (let i = 0; i < n; i++) { const t = Date.now(); s += t - last; last = t; } return s; }
install(now);
console.log(spans(10), ticks);
Date.now = now;
console.log(spans(5), ticks);
Date.now = was;
console.log(typeof spans(3), Date.now === was);
