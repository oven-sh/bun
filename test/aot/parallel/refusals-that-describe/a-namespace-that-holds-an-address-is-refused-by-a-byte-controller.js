// A module namespace object has no prototype and is no plain object: the refusal prints it whole, the address in it by the method of its class.
import * as self from "./a-namespace-that-holds-an-address-is-refused-by-a-byte-controller.js";
export const place = new URL("http://made.up/a");
let text = "no refusal";
new ReadableStream({
  type: "bytes",
  start(controller) {
    try {
      controller.enqueue(self);
    } catch (error) {
      text = `${error}`;
    }
  },
});
console.log(`${text.includes("href")} ${text.includes("must be an instance of")}`);
