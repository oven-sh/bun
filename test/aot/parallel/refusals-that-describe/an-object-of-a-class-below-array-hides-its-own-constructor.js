// The store is on the object, not on the prototype of its class.
class Shelf extends Array {}
const shelf = new Shelf();
shelf.push(new URL("http://made.up/a"));
shelf.constructor = undefined;
let text = "no refusal";
try {
  Buffer.alloc(1).equals(shelf);
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("must be an instance of")}`);
