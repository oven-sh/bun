// Flags: --aot-check=validate-references
// `words[2] === "blue"` in the condition of a loop that writes to no list.
const words = ["red", "green", "blue", ""];
function* turns(a) {
  let done = 0;
  for (let c = 0; c < 4 && (words[2] === "blue" || c < 1); c++) done += a + c;
  return done;
}
let sum = 0;
for (let i = 0; i < 2100; i++) sum = (sum + turns(i).next().value) | 0;
console.log(sum);
