// Reflect.construct makes a map for another new.target: its cell is that of a map, and it stands below another prototype object, so it is no instance of Map.
function isMap(x) { return x instanceof Map; }
function countMaps(x, n) { let s = 0; for (let i = 0; i < n; i++) { if (x instanceof Map) s++; } return s; }

function deed(target) {
  return Reflect.construct(Map, [], target);
}
console.log(String(isMap(new Map())), String(countMaps(new Map(), 100)));
const stray = deed(Object);
console.log(String(isMap(stray)), String(countMaps(stray, 100)), String(Map.prototype.set.call(stray, 1, 2).size), String(Object.getPrototypeOf(stray) === Object.prototype));
function Other() { }
console.log(String(isMap(deed(Other))), String(countMaps(deed(Other), 100)), String(isMap(deed(Map))), String(countMaps(deed(Map), 100)));
class OwnMap extends Map { }
console.log(String(isMap(deed(OwnMap))), String(countMaps(new OwnMap(), 100)), String(isMap(Reflect.construct(Object, [], Map))), String(countMaps(Reflect.construct(Other, [], Map), 100)));
let count = 0;
for (let i = 0; i < 200; i++) count += isMap(i % 3 ? new Map() : deed(i % 2 ? Object : Array)) ? 1 : 0;
console.log(String(count));
