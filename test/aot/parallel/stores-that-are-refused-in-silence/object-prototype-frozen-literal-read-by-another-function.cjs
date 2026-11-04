Object.freeze(Object.prototype);
const E = {};
E.toString = 0;
function read() { return typeof E.toString; }
console.log(read(), read());
