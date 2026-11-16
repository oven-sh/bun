const unseen = (0, eval)("(x) => x");
function make(early) {
  var count;
  function read() { return count; }
  var seen = early ? read() : 0;
  count = 41;
  return function () { return [seen, read() + 1]; };
}
console.log(JSON.stringify(make(unseen(false))()), JSON.stringify(make(unseen(true))()));
