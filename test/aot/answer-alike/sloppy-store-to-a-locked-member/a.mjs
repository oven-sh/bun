// The program replaces a method of Array.prototype and calls it. A module is strict code.
let answer;
try { Array.prototype.push = function () { return "mine"; }; answer = [].push(); } catch (error) { answer = error.name; }
console.log(answer);
