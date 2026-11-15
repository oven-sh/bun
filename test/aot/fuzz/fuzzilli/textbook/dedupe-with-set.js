function unique(list) {
  return [...new Set(list)];
}
function shared(a, b) {
  const held = new Set(b);
  return a.filter(one => held.has(one));
}
console.log(unique(JSON.parse("[3,1,3,2,1]")).join(), shared([1, 2, 3, 4], [2, 4, 6]).join());
