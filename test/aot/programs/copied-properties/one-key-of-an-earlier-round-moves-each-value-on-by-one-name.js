// The value was read in the round before, under the key of that round: each value lands under the next name.
const lines = [];
const source = { first: () => "first", second: () => 2, third: () => [3] };
const target = {};
let held;
for (const key of Object.keys(source)) {
  if (held) target[key] = held;
  held = source[key];
}
lines.push(Object.keys(target).join(), target.second(), target.third(), target.first === undefined);
console.log(lines.join("\n"));
