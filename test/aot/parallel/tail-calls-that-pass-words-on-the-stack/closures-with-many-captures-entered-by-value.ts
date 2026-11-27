// Closures that capture nine to twenty values and take none to five arguments, entered by value: what does not fit into registers goes over the stack, and the entry leaves by a tail call.
type Called = (...given: number[]) => number;
function make(seed: number): Called[] {
  const a = seed + 1, b = seed + 2, c = seed + 3, d = seed + 4, e = seed + 5, f = seed + 6, g = seed + 7, h = seed + 8, i = seed + 9, j = seed + 10;
  const k = seed + 11, l = seed + 12, m = seed + 13, n = seed + 14, o = seed + 15, p = seed + 16, q = seed + 17, r = seed + 18, s = seed + 19, t = seed + 20;
  return [
    () => a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9,
    (x = 0) => a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + x * 1000,
    (x = 0, y = 0) => a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + k * 11 + l * 12 + x * 1000 + y * 2000,
    (x = 0, y = 0, z = 0) => a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + k * 11 + l * 12 + m * 13 + n * 14 + o * 15 + x * 1000 + y * 2000 + z * 3000,
    (x = 0, y = 0, z = 0, w = 0, v = 0) => a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + k * 11 + l * 12 + m * 13 + n * 14 + o * 15 + p * 16 + q * 17 + r * 18 + s * 19 + t * 20 + x * 1000 + y * 2000 + z * 3000 + w * 4000 + v * 5000,
    (...rest) => a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + rest.length * 1000 + (rest.length ? rest[rest.length - 1] : 0),
    (x = 0, ...rest) => a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + k * 11 + x * 500 + rest.length * 1000 + (rest.length ? rest[0] : 0),
  ];
}
const all = [...make(0), ...make(100)];
const said: number[] = [];
for (let turn = 0; turn < 200; turn++) {
  said.length = 0;
  for (const called of all) said.push(called(), called(1), called(1, 2), called(1, 2, 3), called(1, 2, 3, 4, 5), called(1, 2, 3, 4, 5, 6, 7));
}
console.log(said.join(" "));
