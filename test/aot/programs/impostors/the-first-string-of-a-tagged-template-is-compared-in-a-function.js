function tag(site) {
  return site[0];
}
function same(actual, expected) {
  return actual === expected;
}
console.log(same(tag`Hello`, "Hello"));
