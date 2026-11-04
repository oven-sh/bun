function make(value) { const made = {}; made.valueOf = value; made.size = value; return made; }
function read(made) { return typeof made.valueOf + " " + made.size; }
console.log(read(make(1)));
Object.freeze(Object.prototype);
console.log(read(make(2)));
