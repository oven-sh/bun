Object.defineProperty(exports, "number", { enumerable: true, get: function () { return number; } });
const number = 1;
Object.defineProperty(exports, "double", { enumerable: true, get: function () { return double; } });
function double() { return number * 2; }
