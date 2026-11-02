// A read by name that holds no object is stated as such. What follows must still answer for undefined, null and a string, and for a member that a program replaces.
class Thing {
  constructor(message) {
    this.message = message;
  }
}
function lengthOf(thing) {
  return thing.message.length;
}
const answers = [];
for (const value of ["", "text", "wide \u{1F600}"]) answers.push(lengthOf(new Thing(value)));
for (const value of [undefined, null]) {
  try {
    answers.push(lengthOf(new Thing(value)));
  } catch (error) {
    answers.push(error.name);
  }
}
const errors = [new Error("x"), new TypeError("four"), new Error()];
for (const error of errors) answers.push(error.message.length);
const replaced = new Error("short");
Object.defineProperty(replaced, "message", { value: { length: 99 } });
answers.push(replaced.message.length);
const getter = new Error("short");
Object.defineProperty(getter, "message", {
  get() {
    return [1, 2, 3];
  },
});
answers.push(getter.message.length);
console.log(answers.join(" "));
