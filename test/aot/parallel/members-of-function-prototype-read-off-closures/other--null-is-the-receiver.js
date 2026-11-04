function f() { "use strict"; return this === null; }
function h() { return this === globalThis; }
console.log(f.call(null), h.call(null), h.call(undefined));
