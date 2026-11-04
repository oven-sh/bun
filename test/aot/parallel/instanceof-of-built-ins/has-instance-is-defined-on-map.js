// Code tries to give Map a Symbol.hasInstance of its own between two `instanceof` tests against it. A compiled executable refuses the definition, plain Bun takes it: either way the tests answer by what Map has then.
function isMap(x) { return x instanceof Map; }
function countMaps(x, n) { let s = 0; for (let i = 0; i < n; i++) { if (x instanceof Map) s++; } return s; }

let asked = 0;
function deed() {
  try {
    Object.defineProperty(Map, Symbol.hasInstance, { value(x) { asked++; return x === "map"; }, configurable: true });
    return true;
  } catch (error) {
    return false;
  }
}
console.log(String(isMap(new Map())), String(isMap("map")), String(countMaps(new Map(), 100)), String(asked));
const defined = deed();
console.log(String(isMap(new Map()) === !defined), String(isMap("map") === defined), String(countMaps(new Map(), 100) === (defined ? 0 : 100)), String(countMaps("map", 100) === (defined ? 100 : 0)), String(asked === (defined ? 202 : 0)));
console.log(String(Object.prototype.hasOwnProperty.call(Map, Symbol.hasInstance) === defined));
