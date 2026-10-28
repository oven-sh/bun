// Calls that could have lent closures, and lend none, go far down the stack and return. At eight depths of that stretch of the stack an async function splits a text without a line break ahead of its first await.
function twice(read, depth) {
  if (depth > 0) return twice(read, depth - 1);
  return read() + read();
}
function descend(depth, lends, value) {
  if (lends)
    return (
      twice(() => value + 1, 2) + twice(() => value + 2, 2) + twice(() => value + depth, 2) + twice(() => depth + 4, 2)
    );
  if (depth > 0) return descend(depth - 1, lends, value) + 1;
  return value;
}
const turns = process.argv.length > 99 ? 9 : 8;
let calls = 0;
async function head(text) {
  const first = text.split("\n")[0];
  await null;
  return first;
}
function at(text, depth) {
  calls++;
  if (depth > 0) {
    const inner = at(text, depth - 1);
    calls++;
    return inner;
  }
  return head(text);
}
const seen = [];
for (let turn = 0; turn < turns; turn++) {
  seen.push(descend(40, turns > 8, turn));
  seen.push(await at("line " + turn, turn));
}
seen.push(descend(2, true, 1), calls);
console.log(seen.join(" "));
