export function size(value) {
  return value.length;
}
export function first(value) {
  return value[0];
}
export function total(value) {
  var sum = 0;
  for (var item of value) sum += item;
  return sum;
}
export function indexed(value) {
  var sum = 0;
  for (var i = 0; i < value.length; i++) sum += value[i];
  return sum;
}
export function sorted(value) {
  return value.sort();
}
export function counted(value) {
  return value.size;
}
export function asked(value) {
  return value.has(1);
}
export function each(value) {
  var seen = [];
  value.forEach(function (item, key) {
    seen.push(key + ":" + item);
  });
  return seen.join();
}
export function unpacked(value) {
  var [a, b] = value;
  return [a, b];
}
