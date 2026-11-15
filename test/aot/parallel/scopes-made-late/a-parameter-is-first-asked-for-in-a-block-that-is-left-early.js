function labeled(early, value) {
  block: {
    if (early) break block;
    value += 1;
  }
  return () => value++;
}
function nested(a, b, value) {
  {
    if (a) {
      {
        if (b) {
          value += 1;
        }
      }
    }
  }
  const read = () => value;
  value += 10;
  return read;
}
const x = labeled(true, 1), y = labeled(false, 1);
console.log(x(), x(), y(), y(), nested(true, true, 0)(), nested(true, false, 0)(), nested(false, true, 0)());
