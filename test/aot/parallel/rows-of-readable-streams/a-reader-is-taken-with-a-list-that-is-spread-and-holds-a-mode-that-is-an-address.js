// No argument is written between the parentheses but a list that is spread.
const stream = new Blob(["made up"]).stream();
const operands = [{ mode: new URL("http://made.up/a") }];
let text = "no refusal";
try {
  stream.getReader(...operands);
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("made.up")}`);
