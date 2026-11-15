// The same with what was born without a constructor.
import * as self from "./a-namespace-that-holds-an-address-is-refused-by-buffer-from.js";
export const place = new URL("http://made.up/a");
let text = "no refusal";
try {
  Buffer.from(self);
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("made.up")}`);
