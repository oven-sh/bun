const yes = process.argv.length > 0;
function* inner(more) {
  yield 1;
  if (more) yield 10;
  throw "stop";
}
function* outer(more) {
  try {
    for (const value of inner(more)) yield value;
  } catch {
    yield 100;
  }
}
function consume(more) {
  let sum = 0;
  for (const value of outer(more)) sum += value;
  return sum;
}
console.log(consume(yes));
console.log(consume(!yes));
