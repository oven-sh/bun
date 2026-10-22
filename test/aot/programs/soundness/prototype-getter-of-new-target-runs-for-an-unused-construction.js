let reads = 0;
const T = function () {}.bind(null);
Object.defineProperty(T, "prototype", { get() { reads++; return Map.prototype; } });
function make(t) { Reflect.construct(Map, [], t); Reflect.construct(Array, [], t); Reflect.construct(Object, [], t); Reflect.construct(Date, [], t); }
make(T); console.log(reads);
