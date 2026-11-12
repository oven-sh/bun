// Reference: bun build --compile
import text from "./marked.txt";
console.log(text.length, Array.from(text, (letter) => letter.codePointAt(0).toString(16)).join());
