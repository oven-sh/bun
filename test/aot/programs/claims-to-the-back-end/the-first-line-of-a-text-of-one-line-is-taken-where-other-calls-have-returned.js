// Calls that could have lent closures, and lend none, go far down the stack and return. At eight depths of that stretch of the stack a text without a line break is split and its first line taken.
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
function head(text, depth) {
  if (depth > 0) return "." + head(text, depth - 1);
  return text.split("\n")[0];
}
const turns = process.argv.length > 99 ? 9 : 8;
const seen = [];
for (let turn = 0; turn < turns; turn++) {
  seen.push(descend(40, turns > 8, turn));
  seen.push(head("line " + turn, turn));
}
seen.push(descend(2, true, 1));
console.log(seen.join(" "));
