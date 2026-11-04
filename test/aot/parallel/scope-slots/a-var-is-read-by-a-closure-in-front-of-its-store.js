// What a `var` holds at first is undefined, and a function declared beside it sees that.
function make() {
  const seen = look();
  var count = 5;
  return [String(seen), look()].join();
  function look() { return count; }
}
function counter() {
  function bump() { return ++n; }
  const first = bump();
  var n = 10;
  return [String(first), bump()].join();
}
for (let round = 0; round < 3; round++) console.log(make(), counter());
