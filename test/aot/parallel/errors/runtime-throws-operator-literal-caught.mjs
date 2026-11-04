// No function of the program or of the library is called where these throw: the length of a list, an operator, a spread, the text of a pattern.
const isOn = process.argv.length > 0;
function show(name, run) {
  try {
    console.log(name, typeof run());
  } catch (error) {
    console.log(name, "caught", error.name);
  }
}
show("a list of a negative length", () => new Array(isOn ? -1 : 1));
show("a bigint and a number", () => (isOn ? 1n : 2n) + (isOn ? 1 : 2n));
show("a symbol and a text", () => (isOn ? Symbol() : "s") + "");
show("a spread of a number", () => [...(isOn ? 5 : [])]);
show("bytes of a negative length", () => new Uint8Array(isOn ? -1 : 1));
show("a pattern that does not end", () => new RegExp(isOn ? "(" : "a"));
