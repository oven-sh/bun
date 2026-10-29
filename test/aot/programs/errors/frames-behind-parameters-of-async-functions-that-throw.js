// Prints the frames of an error that the parameters of an async function throw. An executable lists the function itself, with or without an `await` in its body.
function fail() {
  throw new Error("fail");
}
const inThisFile = /frames-behind-parameters-of-async-functions-that-throw/;
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .filter(line => inThisFile.test(line))
    .map(line => /^\s*at (.*?) ?\(?[^ ()]*:(\d+:\d+)\)?$/.exec(line))
    .map(found => `${found[1]}@${found[2]}`)
    .join(" < ");
}
async function show(label, run) {
  try {
    await run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", framesOf(error));
  }
}
async function takesPattern({ part }) {
  await part;
}
async function takesDefault(value = fail()) {
  await value;
}
async function takesListPattern([first]) {
  return await first;
}
async function takesPatternAndNeverWaits({ part }) {
  return part;
}
const takesPatternInArrow = async ({ part }) => {
  await part;
};
class Holder {
  async takesPattern({ part }) {
    await part;
  }
  static async takesDefault(value = fail()) {
    await value;
  }
}
await show("a pattern", () => takesPattern(null));
await show("a default value", () => takesDefault());
await show("a list pattern", () => takesListPattern(null));
await show("a pattern, no await", () => takesPatternAndNeverWaits(null));
await show("a pattern of an arrow function", () => takesPatternInArrow(null));
await show("a pattern of a method", () => new Holder().takesPattern(null));
await show("a default value of a static method", () => Holder.takesDefault());
const takesPatternInArrowThatAlsoWaits = async ({ part }) => {
  await part;
};
await show("an arrow function that is handed an object", () => takesPatternInArrowThatAlsoWaits({ part: 1 }));
await show("a pattern of that arrow function", () => takesPatternInArrowThatAlsoWaits(null));
