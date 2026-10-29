// The text of a.mjs as sloppy code.
let answer;
try { Array.prototype.push = function () { return "mine"; }; answer = [].push(); } catch (error) { answer = error.name; }
console.log(answer);
