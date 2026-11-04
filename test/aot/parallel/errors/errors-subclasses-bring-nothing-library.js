// The compiler knows what a new error holds: `message` and `stack` are texts, `line` is a number, and a class that extends Error stays the program's own. So nothing of Bun's library comes in for them.
// STATISTIC: ImageFunctionsEmitted <= 40
class Refused extends Error {
  describe() { return `${this.name}: ${this.message.length}`; }
}
const refused = new Refused("no");
console.log(refused.describe(), refused.stack.length > 0, refused.line > 0, new TypeError("kind").message.toUpperCase(), new Error("plain").stack.split("\n")[0]);
