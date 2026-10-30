// fuzz/built-ins-that-change-what-they-are-handed-read-beside-the-call.ts: small programs in which a built-in changes what it is called on or handed (a regular expression's `lastIndex`,
// a list's length, a map's size, the bytes of a buffer that two views share, a date, an iterator, an object, `process.env`), and the program reads that beside the call. Every line is printed at once.
import { generate } from "../built-ins-that-change-what-they-are-handed-read-beside-the-call";
import { Random } from "../random";
import { endless } from "../family";

export default endless("built-ins that change what they are handed, read beside the call", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
