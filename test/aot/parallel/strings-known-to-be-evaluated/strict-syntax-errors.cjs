// What strict code refuses stays a SyntaxError of the run, beside code of the file that has the same syntax.
const say = (...a) => console.log(...a);
const attempt = (name, f) => { try { say(name, typeof f()); } catch (e) { say(name, e.name, e.message); } };
function own() { "use strict"; }
function mixed(x) { if (x) function inner() {} l: for (;;) { break l; } delete mixed.y; [mixed.z] = [1]; return new.target; }
attempt(1, () => new Function("a", "'use strict'; arguments = 1;"));
attempt(2, () => new Function("a", "'use strict'; arguments++;"));
attempt(3, () => new Function("a", "'use strict'; var arguments;"));
attempt(4, () => new Function("a", "'use strict'; function eval() {}"));
attempt(5, () => new Function("a", "'use strict'; if (a) function f() {}"));
attempt(6, () => new Function("a", "'use strict'; l: function f() {}"));
attempt(7, () => new Function("a", "'use strict'; { function f() {} function f() {} }"));
attempt(8, () => new Function("a", "'use strict'; switch (a) { case 1: function f() {} case 2: function f() {} }"));
attempt(9, () => new Function("a", "'use strict'; implements = 1;"));
attempt(10, () => new Function("a", "'use strict'; var let = 1;"));
attempt(11, () => new Function("a", "'use strict'; var yield;"));
attempt(12, () => new Function("a", "'use strict'; [arguments] = [1];"));
attempt(13, () => new Function("a", "'use strict'; delete a;"));
attempt(14, () => new Function("a", "'use strict'; return function (eval) {};"));
attempt(15, () => new Function("a", "'use strict'; try {} catch (arguments) {}"));
attempt(16, () => new Function("a", "'use strict'; l: { break m; }"));
attempt(17, () => new Function("a", "return /(/;"));
attempt(18, () => new Function("a", "return /a/gg;"));
attempt(19, () => eval("(function () { 'use strict'; arguments = 1; })"));
attempt(20, () => eval("(function () { 'use strict'; { function f() {} function f() {} } })"));
attempt(21, () => new Function("a", "if (a) function f() {} l: function g() {} { function h() {} function h() {} } arguments = 1; var yield, let; return typeof f + typeof h;"));
