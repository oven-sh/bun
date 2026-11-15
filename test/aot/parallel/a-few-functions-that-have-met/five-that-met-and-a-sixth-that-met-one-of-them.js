function run(step) { return step(); }
function look(step) { return typeof step; }
function pick(flag, first, second) { return flag ? first : second; }
const one = () => 1, two = () => 2, three = () => 3, four = () => 4, five = () => 5, six = () => 6;
console.log(run(one), run(two), run(three), run(four), run(five), look(five), look(six));
console.log(run(pick(process.argv.length > 99, five, six)));
