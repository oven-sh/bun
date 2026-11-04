function make(n) { const made = {}; made.valueOf = function () { return n; }; return made; }
console.log(make(2) + 1);
Object.freeze(Object.prototype);
console.log(String(make(2) + 1).slice(0, 15));
