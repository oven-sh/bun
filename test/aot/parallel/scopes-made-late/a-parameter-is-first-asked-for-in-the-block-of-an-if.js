function bump(flag, count) {
  if (flag) {
    count += 1;
  }
  return () => count++;
}
function either(flag, count) {
  if (flag) {
    count += 1;
  } else {
    count -= 1;
  }
  const read = () => count;
  count *= 2;
  return read;
}
const a = bump(true, 1), b = bump(false, 1);
console.log(a(), a(), b(), b(), either(true, 5)(), either(false, 5)());
