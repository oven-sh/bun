// Functions without written types, each called in more than twenty places. Every call is read for what it passes, however many there are.
function twice(value) {
  return value + value;
}
function half(value) {
  return value / 2;
}
let sum = 0;
for (let i = 0; i < 300; i++) sum += twice(i) + half(i);
sum += twice(1) + twice(2) + twice(3) + twice(4) + twice(5) + twice(6) + twice(7) + twice(8) + twice(9) + twice(10);
sum += twice(11) + twice(12) + twice(13) + twice(14) + twice(15) + twice(16) + twice(17) + twice(18) + twice(19);
sum += half(1) + half(2) + half(3) + half(4) + half(5) + half(6) + half(7) + half(8) + half(9) + half(10);
sum += half(11) + half(12) + half(13) + half(14) + half(15) + half(16) + half(17) + half(18) + half(19);
console.log(sum, twice(2 ** 31), twice("ab"), twice(0.25), String(twice(undefined)), half(2 ** 31));
