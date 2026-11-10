// Under: --no-compile-function-source: an executable without the text of functions has no code to quote; its messages spelled the key reckoned at run time ('undefined["the text"]') and described the right side of `in` by its value, where plain Bun quotes the code and prints neither.
const text = JSON.parse('"a text of the user"');
const number = JSON.parse("12345.678");
const holder = JSON.parse('{"held":"another text of the user"}');
const nothing = JSON.parse("[null]")[1];
const none = JSON.parse("null");
const cases = {
  "a text as key read on undefined": () => nothing[text],
  "a text as key read on null": () => none[text],
  "a number as key read on undefined": () => nothing[number],
  "a text as key stored on undefined": () => (nothing[text] = 1),
  "a text as key behind a name": () => holder.none[text],
  "in on a text": () => "x" in text,
  "a text in a text": () => text in text,
  "in on a number": () => "x" in number,
};
for (const [name, fails] of Object.entries(cases)) {
  let thrown = { name: "nothing was thrown", message: "" };
  try {
    fails();
  } catch (error) {
    thrown = error;
  }
  console.log(
    name + ":",
    thrown.name,
    /of the user|12345/.test(thrown.message) ? "whose message holds the value" : "without the value",
  );
}
