// Under: --aot-harden=proof-checks: the second read of undefined was compared as the number that its users take it for, and the program died
let reason = 0;
function check(given) {
  for (let i = 0; i < 3; i++) {
    const x = given[0];
    const isLarge = x > 7;
    const isSmall = x < 3;
    if (isLarge) {
      reason = 1;
      continue;
    }
    if (isSmall) reason = 2;
  }
  return reason;
}
function sum(given) {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const x = given[0];
    if (x > 2) total += x;
    if (x < 2) total -= x;
  }
  return total;
}
for (const list of process.argv.length > 5 ? [] : [[1], [], [7.5], [undefined], [NaN], [9], [, 4], [-0]]) console.log(check(list), sum(list));
