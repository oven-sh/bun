// A conversion to a string has no place of its own in a stack trace: its caller is reported where the last operation in front of it stands. The read of a
// tag that is a local name nobody else sees is no such operation.
function show(label) {
  const lines = String(new Error().stack).split("\n");
  const index = lines.findIndex(text => /at toString/.test(text));
  const found = /:(\d+):(\d+)\)?$/.exec(lines[index + 1] ?? "");
  console.log(label, found ? found[1] + ":" + found[2] : "none");
  return "text";
}
const id = (...values) => values.length;
const tag = (_texts, ...values) => values.length;
const seen = (_texts, ...values) => values.length;
function uses() {
  return [show, id, seen];
}
id(tag`a${`${{ toString: () => String(show("a constant at the top of the file")) }}`}`);
id(seen`a${`${{ toString: () => String(show("a constant that a closure sees")) }}`}`);
id(-id(tag`a${`${{ toString: () => String(show("over several lines")) }}`.length}b${id(1)}`));
function inside(given, other) {
  id(given`a${`${{ toString: () => String(show("a parameter")) }}`}`);
  const local = given;
  id(0);
  id(local`a${`${{ toString: () => String(show("a local constant")) }}`}`);
  id(other`a${`${{ toString: () => String(show("a parameter that a closure sees")) }}`}`);
  return () => other;
}
inside(tag, tag);
