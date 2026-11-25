// One question: built alone, it prints as plain Bun does.
const url = new URL("http://made.up/a"); let text = "no refusal";
class Held extends Array {} Held.prototype.constructor = undefined; const held = new Held(); held.push(url);
try { Buffer.alloc(1).equals(held); } catch (error) { text = `${error}`; }
console.log(`${text.includes("href")} ${text.slice(0, 34)}`);
