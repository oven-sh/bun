// What has no iterator is printed into the message, by its own method.
const url = new URL("http://made.up/a");
let text = "no refusal";
try {
  ReadableStream.from(url);
} catch (error) {
  text = `${error}`;
}
console.log(text.includes("href"));
