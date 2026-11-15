// STATISTIC: NumberKeyStoresUnboxed >= 1
// buffer[at] = x with a captured `at`: the key is a double and the value is stored as it is.
function makeFilter(taps) {
  const buffer = new Array(taps.length).fill(0);
  let at = 0;
  return x => {
    buffer[at] = x;
    let sum = 0;
    for (let i = 0; i < taps.length; i++) sum += taps[i] * buffer[(at - i + taps.length) % taps.length];
    at = (at + 1) % taps.length;
    return sum;
  };
}
const f = makeFilter([0.1, 0.2, 0.4, 0.2, 0.1]), g = makeFilter([0.5, 0.25]);
let total = 0;
for (let i = 0; i < 50; i++) total = total * 0.5 + f(i * 0.5) - g(i);
console.log(total, f(1), g(2));
