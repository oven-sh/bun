// The only call under the name passes nothing; the function is also read and handed its operand by Function.prototype.call.
const stream = new Blob(["made up"]).stream();
stream.getReader().releaseLock();
let text = "no refusal";
try {
  stream.getReader.call(stream, { mode: new URL("http://made.up/a") });
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("made.up")}`);
