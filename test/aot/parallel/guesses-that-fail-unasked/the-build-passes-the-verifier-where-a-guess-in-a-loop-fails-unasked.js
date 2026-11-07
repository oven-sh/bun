// Flags: --aot-testing=FailGuesses --aot-check=Validate
// The read under a key of the run draws the formatter of the library into the executable; one of its functions tests its own parameter inside a loop. Under the word every guess fails unasked, and
// the verifier reads every unit: the proof of a guess stands right behind the branch on its test, with the word or without it.
function countUp() {
  let sum = 0;
  for (let step = 0; step < 2; step++) sum = (sum + step) | 0;
  return [sum][JSON.parse("0")];
}
let line = "";
for (let round = 0; round < 3; round++) line += [String(countUp()), String(countUp())].join("|") + ";";
console.log(line);
