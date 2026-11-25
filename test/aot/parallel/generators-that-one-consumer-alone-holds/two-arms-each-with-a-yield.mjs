const yes = process.argv.length > 0;
function* steps(first) {
  if (first) yield 10;
  else yield 20;
  throw "stop";
}
function consume(first) {
  let sum = 0;
  try {
    for (const value of steps(first)) sum += value;
  } catch {
    return "caught at " + sum;
  }
  return "ended at " + sum;
}
console.log(consume(yes));
console.log(consume(!yes));
