function two(a, b) { return a * 10 + b + arguments.length * 100; }
const none = two.bind(null), all = two.bind(null, 1, 2), more = two.bind(null, 1, 2, 3), many = two.bind(null, 1, 2, 3, 4, 5, 6);
let total = 0;
for (let round = 0; round < 20; round++) total += none(round, 1) + all() + more(9) + many(round);
console.log(total, none.length, all.length, more.length, many.length);
