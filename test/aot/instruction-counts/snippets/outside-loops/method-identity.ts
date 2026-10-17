// asks whether a method is still the one it knows, outside loops
const operations = 4;
function first() {
  return 1;
}
function second() {
  return 2;
}
const holder: { first: () => number; second: () => number } = { first, second };
if (process.argv.length > 50) holder.first = second;
let total = 0;

kernel: {
  if (holder.first !== first) total += 1;
  if (holder.second !== second) total += 2;
  if (holder.first === first) total += 3;
  if (holder.second === second) total += 4;
}

console.log(total);
