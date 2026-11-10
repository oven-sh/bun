// A class that extends Buffer, Uint8Array or TextEncoder gives what plain Bun gives for the inherited functions.
// STATISTIC: ByteLiteralsEncoded = 0
function kindOf(value) {
  const prototype = Object.getPrototypeOf(value);
  return [value.constructor.name, prototype === Buffer.prototype, prototype === Uint8Array.prototype, Buffer.isBuffer(value), String(value)].join(" ");
}
function attempt(label, make) {
  try {
    console.log(label, "|", kindOf(make()));
  } catch (error) {
    console.log(label, "| throws", error.name, "|", error.code, "|", error.message);
  }
}
class OwnBuffer extends Buffer {}
class OwnBytes extends Uint8Array {}
class OwnEncoder extends TextEncoder {}
class LoudEncoder extends TextEncoder {
  encode(input) {
    return super.encode(input + "!");
  }
}
class OwnFrom extends Buffer {
  static from(input) {
    return "the subclass's from got " + input;
  }
}
attempt("OwnBuffer.from", () => OwnBuffer.from("literal"));
attempt("OwnBuffer.from with an encoding", () => OwnBuffer.from("6869", "hex"));
attempt("OwnBuffer.from numbers", () => OwnBuffer.from([1, 2, 3]));
attempt("OwnFrom.from", () => OwnFrom.from("literal"));
attempt("OwnBytes.fromBase64", () => OwnBytes.fromBase64("aGk="));
attempt("OwnBytes.fromHex", () => OwnBytes.fromHex("6869"));
attempt("OwnBytes.of", () => OwnBytes.of(1, 2, 3));
attempt("OwnBytes.from", () => OwnBytes.from([1, 2, 3]));
attempt("new OwnBytes", () => new OwnBytes([1, 2, 3]));
attempt("OwnEncoder", () => new OwnEncoder().encode("literal"));
attempt("LoudEncoder", () => new LoudEncoder().encode("literal"));
