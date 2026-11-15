// STATISTIC: FunctionsLowered <= 400
const { map, filter: kept } = [];
function take({ reduce }) {
  return reduce;
}
let some;
({ some } = []);
console.log(map.call([1, 2], value => value + 1).join(), kept.call([1, 2], value => value > 1).join(), take([]).call([1, 2], (sum, value) => sum + value, 0), some.call([1], value => value === 1));
