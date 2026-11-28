import { sing, songs } from "reedbed";
// A package reads the text of its own code: the executable has that text beside the code.
for (const [name, text] of await songs()) console.log(name, text);
console.log(sing(), globalThis.sung);
