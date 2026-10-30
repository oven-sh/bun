function last(list) {
  return list[list.length - 1];
}
function has(list, item) {
  return list.indexOf(item) !== -1;
}
function part(list) {
  return list.slice(1, 3);
}
function glued(list, more) {
  return list.concat(more);
}
function fromTheEnd(list) {
  return list.at(-1);
}
function contains(list, item) {
  return list.includes(item);
}
function size(list) {
  return list.length;
}
function spread(list) {
  return [...list];
}
function joined(list) {
  return list.join("-");
}
function stored(list) {
  list[0] = "z";
  return list[0];
}
function shortened(list) {
  list.length = 2;
  return list.length;
}
module.exports = { last, has, part, glued, fromTheEnd, contains, size, spread, joined, stored, shortened };
