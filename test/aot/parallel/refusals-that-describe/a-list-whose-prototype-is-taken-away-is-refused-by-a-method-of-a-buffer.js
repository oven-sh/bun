// No write under `constructor`: the prototype goes.
const list = [new URL("http://made.up/a")];
Object.setPrototypeOf(list, null);
let text = "no refusal";
try {
  Buffer.alloc(1).copy(list);
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("made.up")} ${text.slice(0, 34)}`);
