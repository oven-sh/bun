// viewSource(..) answers a list of texts, or one text for a callback.
import { viewSource } from "bun:ffi";

const texts = viewSource({ first: { args: ["i32"], returns: "i32" }, second: { args: [], returns: "void" } });
console.log(String(Array.isArray(texts)), String(texts.length), typeof texts[0], typeof texts[1]);
console.log(
  String(texts[0].includes("first(")),
  String(texts[1].includes("second(")),
  String(texts.map(text => text.length > 100).join()),
);
const one = viewSource({ args: ["i32"], returns: "i32" }, true);
console.log(typeof one, String(one.startsWith("//")), String(one.length > 10));
