function pick(first, x, y) { return first ? x : y; }
let sum = 0;
for (let i = 0; i < 50; i++) {
  const got = pick(i % 2 === 0, { even: i }, { odd: i, more: "m" + i });
  sum += got.even === undefined ? got.odd * 2 + got.more.length : got.even;
}
console.log(sum);
