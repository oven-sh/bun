// Text that is evaluated stores under new names on `process`, which it finds on the global object like anybody. The program computes with what it reads there.
// The table lists all members of `process`: all that the host puts there. A read that was only handed on was right; one that the program computed with took the name for absent.
const text = "process.flagOfTheText = 1; process.helperOfTheText = () => 7; URL.flagOfTheText = 4; process.test = 5";
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
say("handed on", () => process.flagOfTheText);
say("plus one", () => process.flagOfTheText + 1);
say("a condition", () => (process.flagOfTheText ? "yes" : "no"));
say("or else", () => process.flagOfTheText ?? "absent");
say("a template", () => `<${process.flagOfTheText}>`);
say("is undefined", () => process.flagOfTheText === undefined);
say("typeof", () => typeof process.flagOfTheText);
say("in", () => "flagOfTheText" in process);
say("a pattern", () => (({ flagOfTheText }) => flagOfTheText * 3)(process));
say("a call", () => process.helperOfTheText());
say("an optional call", () => process.helperOfTheText?.() ?? "none");
say("through the global object", () => globalThis.process.flagOfTheText + 1);
say("a class of the host", () => URL.flagOfTheText + 1);
say("a name that other objects have", () => process.test + 1);
say("never stored", () => process.neverStored + 1);
say("a member", () => typeof process.pid + " " + typeof process.on);
