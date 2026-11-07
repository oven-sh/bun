// Reference: bun build --compile
import text from "./marked.txt";
console.log(text.length, Array.from(text, (letter) => letter.charCodeAt(0)).join());
