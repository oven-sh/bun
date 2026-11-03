// map()'s callback writes the list and reduce()'s callback looks at the list it is given, so the two stay two loops with a list between them. Each loop still has its tests in front of it and none in its turns.
// COUNT: cells <= 1020
// COUNT: branches <= 79100
const turns = Number(process.env.TURNS ?? 1000);
const values = [3, 1, 4, 1, 5, 9, 2, 6];
let sum = 0;
for (let i = 0; i < turns; i++) {
  sum =
    (sum +
      values
        .map((value, at) => {
          if (at === 2) values[5] = i & 15;
          return value * (i & 7);
        })
        .reduce((a, b, at, list) => a + b + list.length, 0)) |
    0;
}
console.log(sum, values.join());
