// Parameter lists that look like the rejected ones.
function f(a, ...b) {}
function f(a) { "use strict"; }
function f(a = 1) { "use sloppy"; }
function f(a,) {}
(a) =>⏎1;
// ECMAScript rejects the next four. bun run starts them: its transpiler removes the "use strict" directive of a function.
function f(a = 1) { "use strict"; }
function f({ a }) { "use strict"; }
(a = 1) => { "use strict"; };
function f(...a) { "use strict"; }
