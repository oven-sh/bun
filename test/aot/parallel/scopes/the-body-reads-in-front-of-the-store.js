const unseen = (0, eval)("(x) => x");
function make(flag) {
  var size;
  const grow = () => { size = size + 1; return size; };
  const before = flag ? String(size) : "skipped";
  size = 10;
  return before + " " + grow();
}
console.log(make(unseen(false)), make(unseen(true)));
