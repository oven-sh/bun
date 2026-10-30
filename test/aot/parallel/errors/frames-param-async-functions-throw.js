// Prints the frames of an error that the parameters of an async function throw. An executable lists the function itself, with or without an `await` in its body.
function fail() {
  throw new Error("fail");
}
const inThisFile = /frames-param-async-functions-throw/;
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
/* Output:
a pattern | TypeError | takesPattern@23:9 < show@16:11 < @45:7
a default value | Error | fail@3:13 < takesDefault@25:37 < show@16:11 < @46:7
a list pattern | TypeError | takesListPattern@28:32 < show@16:11 < @47:7
a pattern, no await | TypeError | takesPatternAndNeverWaits@32:10 < show@16:11 < @48:7
a pattern of an arrow function | TypeError | <anonymous>@35:9 < show@16:11 < @49:7
a pattern of a method | TypeError | takesPattern@39:11 < show@16:11 < @50:7
a default value of a static method | Error | fail@3:13 < takesDefault@41:37 < show@16:11 < @51:7
an arrow function that is handed an object | no error
a pattern of that arrow function | TypeError | <anonymous>@53:9 < show@16:11 < @56:7
*/
