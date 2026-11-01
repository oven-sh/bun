// Text that is evaluated stores under new names on functions of the host, which it finds like anybody: a static function, a method of a prototype, a method of `process`.
// The table lists all members of such a function. A read that the program computed with took the new name for absent: `Buffer.from.flagOfTheText + 1` was NaN.
const text = `
  Buffer.from.flagOfTheText = 4;
  Buffer.from.helperOfTheText = () => 7;
  Buffer.alloc.flagOfTheText = 5;
  Buffer.prototype.write.flagOfTheText = 6;
  process.cwd.flagOfTheText = 8;
`;
(0, eval)(text);
const say = (label, use) => {
  let seen;
  try {
    seen = String(use());
  } catch (error) {
    seen = "throws " + error.name;
  }
  console.log(label, "|", seen);
};
say("handed on", () => Buffer.from.flagOfTheText);
say("plus one", () => Buffer.from.flagOfTheText + 1);
say("a condition", () => (Buffer.from.flagOfTheText ? "yes" : "no"));
say("or else", () => Buffer.from.flagOfTheText ?? "absent");
say("a template", () => `<${Buffer.from.flagOfTheText}>`);
say("is undefined", () => Buffer.from.flagOfTheText === undefined);
say("in", () => "flagOfTheText" in Buffer.from);
say("a pattern", () => (({ flagOfTheText }) => flagOfTheText * 3)(Buffer.from));
say("a call", () => Buffer.from.helperOfTheText());
say("an optional call", () => Buffer.from.helperOfTheText?.() ?? "none");
say("another static function", () => Buffer.alloc.flagOfTheText + 1);
say("a method of a prototype", () => Buffer.prototype.write.flagOfTheText + 1);
say("that method through an instance", () => Buffer.alloc(1).write.flagOfTheText + 1);
say("a method of process", () => process.cwd.flagOfTheText + 1);
say("never stored", () => Buffer.from.neverStored + 1);
say("on a function nothing was stored on", () => Buffer.concat.flagOfTheText + 1);
say("what the table lists", () => Buffer.from.name + " " + Buffer.from.length + " " + typeof Buffer.from.call);
say("the function still works", () => Buffer.from("ab").toString("hex"));
