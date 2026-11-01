// The host reaches a registered symbol through the registry, as a program does: a web stream answers node:stream's three questions with getters under such symbols, which no table lists.
const stream = new ReadableStream();

function isReadable() { return stream[Symbol.for("nodejs.stream.readable")]; }
function isErrored() { return stream[Symbol.for("nodejs.stream.errored")]; }
function isDisturbed() { return stream[Symbol.for("nodejs.stream.disturbed")]; }
console.log("in a function:", isReadable(), isErrored(), isDisturbed());

class Holder {
  readable = stream[Symbol.for("nodejs.stream.readable")];
  errored = stream[Symbol.for("nodejs.stream.errored")];
  disturbed = stream[Symbol.for("nodejs.stream.disturbed")];
}
const holder = new Holder();
console.log("as the initializers of fields:", holder.readable, holder.errored, holder.disturbed);

function kind() { const value = stream[Symbol.for("nodejs.stream.readable")]; if (typeof value === "boolean") return value ? 1 : 0; return "no boolean"; }
console.log("behind a test of its type:", kind());

const list = [stream[Symbol.for("nodejs.stream.readable")]];
const { [Symbol.for("nodejs.stream.disturbed")]: disturbed } = stream;
console.log("out of a list, by a pattern:", list[0], disturbed, Symbol.for("nodejs.stream.errored") in stream);

function ofNobody() { return stream[Symbol.for("a symbol that nobody lays anything under")]; }
console.log("under a symbol of the program's own:", ofNobody());

