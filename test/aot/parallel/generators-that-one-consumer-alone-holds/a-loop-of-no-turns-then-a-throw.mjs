const three = process.argv.length > 0 ? 3 : 4;
const none = process.argv.length > 0 ? 0 : 1;
function* steps(limit, step) {
  for (let i = 0; i < limit; i++) yield step + i;
  throw "stop";
}
function consume(limit, step) {
  let sum = 0;
  try {
    for (const value of steps(limit, step)) sum += value;
  } catch {
    return "caught at " + sum;
  }
  return "ended at " + sum;
}
console.log(consume(three, 5));
console.log(consume(none, 5));
