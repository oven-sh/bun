// getReader(options) reads `mode`, makes a string of it, and the message about a wrong one prints it the way console.log does: by a method of the program's own where it has one.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
let asked = 0;
const bytes = () => known({ type: "bytes" });
const byGetter = bytes().getReader({
  get mode() {
    asked += 1;
    return "byob";
  },
});
const byConversion = bytes().getReader({
  mode: {
    toString() {
      asked += 1;
      return "byob";
    },
  },
});
const messages = [];
for (const options of [
  { mode: "made-up" },
  { mode: { [Symbol.for("nodejs.util.inspect.custom")]: () => "<as the program says>" } },
  { mode: { weight: 1 } },
  7,
]) {
  try {
    bytes().getReader(options);
  } catch (error) {
    messages.push(`${error.code}: ${error.message}`);
  }
}
console.log(asked, byGetter.constructor.name, byConversion.constructor.name, bytes().getReader().constructor.name, bytes().getReader(null).constructor.name);
console.log(messages.join("\n"));
