// A store that replaces a member of an always locked built-in builds, with a warning, wherever the program can go on: inside `try`, under a condition, in a function. Where it runs it throws a TypeError. A new ordinary name on the same object or on a namespace, and a store to a member that is left open, are ordinary stores. language/locked-write-stops-the-build has the store that stops the build.
try { Array.prototype.includes = function (value) { return this.indexOf(value) !== -1; }; console.log("in a try: stored"); } catch (e) { console.log("in a try:", e.name); }
if (process.argv.length > 100) Array.prototype.indexOf = function () { return -1; };
console.log("under a condition that is false:", [5].indexOf(5));
function patch() { Array.prototype.flat = function () { return []; }; }
console.log("in a function that is not called yet:", [[1]].flat().length);
function attempt() { try { patch(); return "stored"; } catch (e) { return e.name; } }
console.log("in a function that is called:", attempt());
Array.prototype.last = function () { return this[this.length - 1]; };
console.log("a new name on the same object:", [1, 2, 3].last());
Math.half = n => n / 2;
console.log("a new name on a namespace:", Math.half(8));
Date.now = () => 8;
console.log("a member that is left open:", Date.now());
export {};
