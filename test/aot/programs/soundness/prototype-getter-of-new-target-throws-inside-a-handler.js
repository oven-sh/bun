const T = function () {}.bind(null);
Object.defineProperty(T, "prototype", { get() { throw new RangeError("from getter"); } });
function make(t) { try { Reflect.construct(Map, [], t); return "no throw"; } catch (e) { return "caught " + e.name; } }
console.log(make(T)); console.log(make(Map));
