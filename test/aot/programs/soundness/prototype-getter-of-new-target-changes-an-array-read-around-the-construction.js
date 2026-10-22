const list = [1, 2, 3];
const T = function () {}.bind(null);
Object.defineProperty(T, "prototype", { get() { list.push(4); list[0] = "changed"; return Set.prototype; } });
function make(t) { const a = list.length, x = list[0]; Reflect.construct(Set, [], t); return a + "," + list.length + "," + x + "," + list[0]; }
console.log(make(T)); console.log(make(Set));
