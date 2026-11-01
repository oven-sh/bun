// Flags: --aot-verify-each-pass
// A label out of a list of written texts starts one line and is read again for the next one. The first line is put together in a builder, so what goes on to the second is a text like any other.
interface Failure {
  name: string;
  message: string;
}
function headline(f: Failure): string {
  return f.name + ": " + f.message;
}
class Custom extends Error {
  name = "Custom";
}
const failures: [string, Failure][] = [
  ["plain", { name: "plain", message: "m" }],
  ["a subclass with a name field", new Custom("c")],
];
for (const [label, f] of failures) {
  console.log(label + ": " + headline(f) + " own " + Object.hasOwn(f, "name"));
  console.log(label + ": keys[" + Object.keys(f).join() + "] json " + JSON.stringify(f) + " spread " + JSON.stringify({ ...f }));
}
