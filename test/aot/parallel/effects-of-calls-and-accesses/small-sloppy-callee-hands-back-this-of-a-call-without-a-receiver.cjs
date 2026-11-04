// a small sloppy callee hands back its parameter or `this`, which a call without a receiver makes the global object
function A() { this.a = 1; }
var turns = 0;
function orThis(flag, other) { for (var i = 0; i < 2; i++) turns = turns + 1; return flag ? other : this; }
function deed(flag) { var got = orThis(flag, new A()); return typeof got.a + " " + (got instanceof A) + " " + (got === globalThis); }
console.log(deed(true));
console.log(deed(false));
var all = "";
for (var i = 0; i < 4; i++) all += deed(i % 2 === 0) + ";";
console.log(all + turns);
