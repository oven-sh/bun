// The refusal finds no constructor in the list, which is no plain object, and prints it whole: the address in it by the method of its class.
const list = [new URL("http://made.up/a")];
list.constructor = undefined;
let text = "no refusal";
try {
  Buffer.alloc(1).equals(list);
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("made.up")} ${text.slice(0, 34)}`);
