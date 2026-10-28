var original = require;
var i = 0;
while (i < 2) { require = i; i++; }
console.log("require after while:", require, typeof original);
for (var j = 0; j < 2; j++) { console.log("require at the start of iteration " + j + ":", typeof require); require = original; }
console.log("require restored:", require === original);
