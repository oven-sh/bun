function size(value) {
  return value.length;
}
function first(value) {
  return value[0];
}
function total(value) {
  var sum = 0;
  for (var item of value) sum += item;
  return sum;
}
function indexed(value) {
  var sum = 0;
  for (var i = 0; i < value.length; i++) sum += value[i];
  return sum;
}
function sorted(value) {
  return value.sort();
}
function counted(value) {
  return value.size;
}
function asked(value) {
  return value.has(1);
}
function each(value) {
  var seen = [];
  value.forEach(function (item, key) {
    seen.push(key + ":" + item);
  });
  return seen.join();
}
function unpacked(value) {
  var [a, b] = value;
  return [a, b];
}

module.exports = { size: size, first: first, total: total, indexed: indexed, sorted: sorted, counted: counted, asked: asked, each: each, unpacked: unpacked };
