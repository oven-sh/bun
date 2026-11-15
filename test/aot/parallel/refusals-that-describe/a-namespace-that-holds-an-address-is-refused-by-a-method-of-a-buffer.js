// The same on the older road: a method of a Buffer, which goes by its name.
import * as self from "./a-namespace-that-holds-an-address-is-refused-by-a-method-of-a-buffer.js";
export const place = new URL("http://made.up/a");
let text = "no refusal";
try {
  Buffer.alloc(1).equals(self);
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("must be an instance of")}`);
