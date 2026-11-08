const unseen = (0, eval)("(f) => f()");
function make(early) {
  var total;
  const read = () => total;
  let first = "none";
  if (early) first = typeof unseen(read);
  total = 7;
  return first + " " + (read() + 1);
}
console.log(make(false), make(true));
