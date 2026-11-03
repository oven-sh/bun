// A pattern that asks for more characters than a string can hold has valid syntax and cannot be built: creating it throws a SyntaxError, which a try around it catches.
function show(label, create) {
  try {
    console.log(label, create().source);
  } catch (error) {
    console.log(label, "throws", error.name, error.message);
  }
}

try {
  console.log("at the top level", /a{4294967295}a/.source);
} catch (error) {
  console.log("at the top level throws", error.name, error.message);
}

show("in a function", () => /a{4294967294}aa/);
show("with flags", () => /[ab]{4294967295}[ab]/gi);
show("in a lookahead", () => /x(?=.{4294967295}.)/);
show("in an alternative", () => /a|bb{4294967295}/);
show("as long as a string", () => /a{4294967295}/);
show("text that is a constant", () => new RegExp("a{4294967295}a"));
show("text put together from constants", () => new RegExp("a{" + 4294967295 + "}" + "a", "g"));
show(
  "text made at run time",
  () => new RegExp(["a{", "}a"].join(String(4294967295 + process.argv.length - process.argv.length))),
);

function matches(text) {
  return /^.{2147483647}.{2147483647}..$/.test(text);
}
for (let turn = 0; turn < 3; turn++) {
  try {
    console.log("turn", turn, matches("abc"));
  } catch (error) {
    console.log("turn", turn, "throws", error.name);
  }
}

function cleansUp() {
  try {
    return /b{4294967295}b/.exec("b");
  } finally {
    console.log("finally runs");
  }
}
show("behind a finally", cleansUp);

let reached = "nothing";
try {
  reached = "the statement in front";
  const unused = /c{4294967295}c/;
  reached = "the statement behind";
} catch {}
console.log("reached", reached);
console.log("end");
