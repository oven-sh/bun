// The same for an address inside a record.
let text = "no refusal";
try {
  ReadableStream.from({ held: new URL("http://made.up/a") });
} catch (error) {
  text = `${error}`;
}
console.log(text.includes("made.up"), text.endsWith("must be iterable"));
