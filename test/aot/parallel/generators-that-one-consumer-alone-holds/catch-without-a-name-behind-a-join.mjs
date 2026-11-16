const yes = process.argv.length > 0;
function* steps(more) {
  yield 1;
  if (more) yield 10;
  throw "stop";
}
function consume(more) {
  let sum = 0;
  try {
    for (const value of steps(more)) sum += value;
  } catch {
    return "caught at " + sum;
  }
  return "ended at " + sum;
}
console.log(consume(yes));
console.log(consume(!yes));
