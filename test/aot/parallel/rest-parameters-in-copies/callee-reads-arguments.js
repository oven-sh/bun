function sloppy(a, b) { arguments[0] = "changed"; return [a, b, arguments.length, arguments[2]].join(); }
function strict(a, b) { "use strict"; arguments[0] = "changed"; return [a, b, arguments.length, arguments[2]].join(); }
function passSloppy(...xs) { return sloppy(...xs); }
function passStrict(...xs) { return strict(...xs); }
for (let i = 0; i < 3; i++) console.log(passSloppy(i), passSloppy(i, 2, 3), passStrict(i), passStrict(i, 2, 3));
