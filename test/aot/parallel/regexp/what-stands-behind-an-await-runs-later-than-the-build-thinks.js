// The build goes through an async function in one go. The program does not: what stands behind an `await` runs when the code that called the function has come to its end. Here nobody waits for the function,
// and the pattern is made before its second half has stored the other text: the build foresaw ^later-[0-9]+$, which is in the image and nobody asks for; the program makes ^sooner-[0-9]+$, which has no record,
// and the run time's own matcher gives the answers of plain Bun. A wrong guess costs a miss, never a wrong match.
// COUNTER: RegExpsCreatedWithoutRecord = 1
// COUNTER: RegExpPredictedTextsCreated = 0
const parts = ["^", "sooner", "-[0-9]+$"];
async function change() {
  await null;
  parts[1] = "later";
}
change();
const made = new RegExp(parts.join(""));
console.log(made.source, ["sooner-1", "later-2", "sooner-", "SOONER-3"].map(subject => (made.test(subject) ? 1 : 0)).join(""));
