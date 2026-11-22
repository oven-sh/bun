// STATISTIC: ImageFunctionsEmitted <= 8
function top(from) {
  let up = from;
  while (Object.getPrototypeOf(up)) up = Object.getPrototypeOf(up);
  return up;
}
const parsed = JSON.parse('{"made":"up"}');
console.log(`${top(parsed) === Object.prototype} ${Object.prototype.hasOwnProperty.call(parsed, "made")}`);
