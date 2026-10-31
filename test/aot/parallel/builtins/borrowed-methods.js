// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = value =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label, probe) => {
  let text;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + ": " + text);
};
const arrayLike = { length: 2 ** 53 - 2, push: Array.prototype.push };
class Stack {
  constructor(length) {
    this.made = "made with " + length;
  }
  peek() {
    return [this.made, this.length, this[0]];
  }
}
Stack.of = Array.of;
Stack.from = Array.from;
class Padded {
  toString() {
    return "  padded  ";
  }
}
Padded.prototype.trim = String.prototype.trim;
report("push past 2 ** 32", () => [arrayLike.push(1), arrayLike.length]);
report("Array.of on a class", () => Stack.of(7, 8).peek());
report("Array.from on a class", () => Stack.from([9]).peek());
report("trim on an object", () => new Padded().trim());
report("on their own classes", () => [[1].push(2), Array.of(7, 8), Array.from([9]), "  s  ".trim()]);
