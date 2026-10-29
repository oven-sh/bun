import * as late from "./late.cjs";
import * as made from "./made.cjs";
import * as text from "./text.cjs";
import * as through from "./through.mjs";
const tell = (label, read) => {
  try {
    console.log(label, read());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
};
const key = ["co", "unt"].join("");
tell("text", () => [
  text.count,
  text.first,
  typeof text.count,
  text.count?.(),
  "count" in text,
  text[key],
  Object.keys(text).join(),
]);
tell("made", () => [
  made.count,
  made.first,
  typeof made.count,
  made.count?.(),
  "count" in made,
  made[key],
  Object.keys(made).join(),
]);
tell("late", () => [late.count, late.first]);
globalThis.addCount();
tell("late", () => [late.count, late.first, late.default.count]);
tell("through", () => [through.count, through.first]);
tell("call", () => text.count());
tell("pattern", () => {
  const { count, first } = text;
  return [count, first];
});
