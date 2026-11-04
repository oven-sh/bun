function f() { return typeof this; }
function s() { "use strict"; return typeof this; }
console.log(f.call(1), s.call(1), f.call("x"), s.call("x"));
