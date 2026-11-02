const tell = (label, read) => {
  try {
    console.log(label, read());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
};
tell("require text", () => [require("./text.cjs").count, require("./text.cjs").first]);
const { count, first } = require("./made.cjs");
tell("require made", () => [count, first]);
tell("require late", () => require("./late.cjs").count);
tell("require through", () => [require("./through.mjs").count, require("./through.mjs").first]);
