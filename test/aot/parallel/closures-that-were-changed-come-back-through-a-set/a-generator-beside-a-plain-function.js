function* gen(x) { yield x; }
function plain(x) { return x + 1; }
function run(f, n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const got = f(i);
    sum += typeof got === "object" ? 10 : got;
  }
  return sum + work;
}
let total = 0;
for (let turn = 0; turn < 200; turn++) total += run(turn & 1 ? gen : plain, 4);
console.log(total, run(gen, 4), run(plain, 4));
