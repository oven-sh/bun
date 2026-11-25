// The integers of an iteration are cut from wide ones and come round as numbers; nothing behind the loop reads them.
function remainders(n) {
  let s = 12345, p = 1, a = 0.5, b = 0.25, sum = 0;
  for (let i = 0; i < n; i++) {
    s = (s * 16807 % 2147483647) | 0;
    const x = s;
    const o = x * 0.25 + p * 0.125 + a * 0.5 + b * -0.125 + a * b * 1e-12 + a * 0.01 + b * 0.02;
    b = a; a = o; p = x;
    sum += o * 0.5 + a * 0.25 - b;
  }
  return [sum, a, b].join();
}
function products(n) {
  let p = 1, r = 2, a = 0.5, b = 0.25, sum = 0;
  for (let i = 0; i < n; i++) {
    const x = (i * 2654435) % 8191;
    const o = x * 0.25 + p * 0.125 + r * 0.0625 + a * 0.5 + b * -0.125 + x * 1e-9 + a * b * 1e-7 + a * 0.01 + b * 0.02;
    b = a; a = o; r = p; p = x;
    sum += o * 0.5 + a * 0.25 - b;
  }
  return [sum, a, b].join();
}
function elements(n, list) {
  let p = 1, a = 0.5, b = 0.25, sum = 0;
  for (let i = 0; i < n; i++) {
    const x = list[i & 7] | 0;
    const o = x * 0.25 + p * 0.125 + a * 0.5 + b * -0.125 + a * b * 1e-12 + a * 0.01 + b * 0.02;
    b = a; a = o; p = x;
    sum += o * 0.5 + a * 0.25 - b;
  }
  return [sum, a, b].join();
}
const list = [3, 1, 4, 1, 5, 9, 2, 6], mixed = [3, 1, 4, 1.5, 5, 9, 2, "6"];
console.log(remainders(1000), remainders(1048575), remainders(1048577), remainders(1048579), remainders(2097153), remainders(3145731));
console.log(products(1000), products(1048575), products(1048577), products(1048579), products(2097153), products(3145731));
console.log(elements(1000, list), elements(1048577, mixed), elements(2097153, list), elements(3145731, mixed));
