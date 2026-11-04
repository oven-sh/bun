// Flags: --aot-check=validate-references
// `text === "blue"` in the condition of a loop. The text is the same in every turn and nothing reads it behind the comparison.
function* turns(source, limit) {
  const text = String(JSON.parse(source));
  let done = 0;
  for (let c = 0; c < limit && (text === "blue" || c < 1); c++) done += c + 1;
  return done;
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum = (sum + turns(i & 1 ? '"blue"' : '"pink"', 40 + (i & 3)).next().value) | 0;
console.log(sum);
