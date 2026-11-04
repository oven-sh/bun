"use strict";
let kind = "none";
function onTime() { kind = typeof this; }
const t = setTimeout(onTime, 100000);
new Function("t", process.argv[2] ?? "t._onTimeout.call(5)")(t);
clearTimeout(t);
console.log(kind);
