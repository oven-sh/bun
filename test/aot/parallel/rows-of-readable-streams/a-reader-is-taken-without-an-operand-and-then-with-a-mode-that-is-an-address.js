// The name is called with nothing first and with an operand later: the refusal prints the address by the method of its class.
const stream = new Blob(["made up"]).stream();
stream.getReader().releaseLock();
let text = "no refusal";
try {
  stream.getReader({ mode: new URL("http://made.up/a") });
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("made.up")}`);
