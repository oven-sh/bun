function sum(point) {
  return point.x + point.y;
}
function keys(point) {
  return Object.keys(point);
}
function everyKey(point) {
  return Reflect.ownKeys(point).map(String);
}
function walked(point) {
  var seen = [];
  for (var key in point) seen.push(key + "=" + typeof point[key]);
  return seen;
}
function stored(point) {
  point.x = 10;
  return point.x;
}
function storedStrictly(point) {
  "use strict";
  point.x = 10;
  return point.x;
}
function added(point) {
  point.z = 3;
  return "z" in point;
}
function addedStrictly(point) {
  "use strict";
  point.z = 3;
  return "z" in point;
}
function removed(point) {
  return delete point.y;
}
function removedStrictly(point) {
  "use strict";
  return delete point.y;
}
function copied(point) {
  return Object.assign({}, point);
}
function spread(point) {
  return { ...point };
}
function written(point) {
  return JSON.stringify(point);
}
function asked(point) {
  return point.hasOwnProperty("x");
}
function glued(point) {
  return "" + point;
}
function tagged(point) {
  return Object.prototype.toString.call(point);
}
function described(point) {
  var property = Object.getOwnPropertyDescriptor(point, "x");
  return [typeof property.value, typeof property.get, property.writable, property.enumerable, property.configurable];
}
function redefined(point) {
  return Reflect.defineProperty(point, "x", { value: 99 });
}
function parent(point) {
  return Object.getPrototypeOf(point) === Object.prototype;
}
function unpacked(point) {
  var { x, y, z = "default" } = point;
  return [x, y, z];
}
function absent(point) {
  return [point.nothing, "nothing" in point, point.toString === undefined];
}

module.exports = { sum, keys, everyKey, walked, stored, storedStrictly, added, addedStrictly, removed, removedStrictly, copied, spread, written, asked, glued, tagged, described, redefined, parent, unpacked, absent };
