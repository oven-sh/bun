function mixed(a, b = a + 1, ...rest) { return [a, b, rest.length, rest.join("-")].join(); }
for (let i = 0; i < 3; i++) console.log(mixed(), mixed(i), mixed(i, undefined), mixed(i, 5), mixed(i, 5, 6), mixed(i, undefined, 6, 7, 8));
console.log(mixed.length);
