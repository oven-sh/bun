export function sum(point) {
  return point.x + point.y;
}
export function keys(point) {
  return Object.keys(point);
}
export function everyKey(point) {
  return Reflect.ownKeys(point).map(String);
}
export function walked(point) {
  var seen = [];
  for (var key in point) seen.push(key + "=" + typeof point[key]);
  return seen;
}
export function stored(point) {
  point.x = 10;
  return point.x;
}
export function storedStrictly(point) {
  point.x = 10;
  return point.x;
}
export function added(point) {
  point.z = 3;
  return "z" in point;
}
export function addedStrictly(point) {
  point.z = 3;
  return "z" in point;
}
export function removed(point) {
  return delete point.y;
}
export function removedStrictly(point) {
  return delete point.y;
}
export function copied(point) {
  return Object.assign({}, point);
}
export function spread(point) {
  return { ...point };
}
export function written(point) {
  return JSON.stringify(point);
}
export function asked(point) {
  return point.hasOwnProperty("x");
}
export function glued(point) {
  return "" + point;
}
export function tagged(point) {
  return Object.prototype.toString.call(point);
}
export function described(point) {
  var property = Object.getOwnPropertyDescriptor(point, "x");
  return [typeof property.value, typeof property.get, property.writable, property.enumerable, property.configurable];
}
export function redefined(point) {
  return Reflect.defineProperty(point, "x", { value: 99 });
}
export function parent(point) {
  return Object.getPrototypeOf(point) === Object.prototype;
}
export function unpacked(point) {
  var { x, y, z = "default" } = point;
  return [x, y, z];
}
export function absent(point) {
  return [point.nothing, "nothing" in point, point.toString === undefined];
}
export function state(point) {
  return [Object.isFrozen(point), Object.isSealed(point), Object.isExtensible(point)];
}
