// case: three parameters and an answer: tak
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 8;
function tak(x, y, z) {
  if (!(y < x)) return z;
  return tak(tak(x - 1, y, z), tak(y - 1, z, x), tak(z - 1, x, y));
}
function work(n) { return tak(n + 4, n, n / 2); }
function model(n) {
  const known = new Map();
  const take = (x, y, z) => {
    const key = x + "," + y + "," + z + far;
    if (!known.has(key)) known.set(key, x <= y ? z : take(take(x - 1, y, z), take(y - 1, z, x), take(z - 1, x, y)));
    return known.get(key);
  };
  return take(n + 4, n, n / 2);
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
