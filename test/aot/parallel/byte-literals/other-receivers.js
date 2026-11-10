// Buffer.from, TextEncoder.prototype.encode and the static functions of Uint8Array are called with other receivers.
// STATISTIC: ByteLiteralsEncoded = 5
function kindOf(value) {
  if (typeof value !== "object" || value === null) return typeof value + " " + String(value);
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
class Other {
  constructor(...given) {
    this.given = given.length;
  }
}
attempt("Buffer.from.call(undefined)", () => Buffer.from.call(undefined, "literal"));
attempt("Buffer.from.call(null)", () => Buffer.from.call(null, "6869", "hex"));
attempt("Buffer.from.call(Other)", () => Buffer.from.call(Other, "literal"));
attempt("Buffer.from.call(Uint8Array)", () => Buffer.from.call(Uint8Array, "literal"));
attempt("Buffer.from.apply", () => Buffer.from.apply(Buffer, ["6869", "hex"]));
attempt("Reflect.apply of Buffer.from", () => Reflect.apply(Buffer.from, undefined, ["literal"]));
attempt("Buffer.from.bind", () => Buffer.from.bind(null, "6869")("hex"));
attempt("new Buffer.from", () => new Buffer.from("literal"));
attempt("new Buffer.from with an encoding", () => new Buffer.from("6869", "hex"));
attempt("Reflect.construct of Buffer.from", () => Reflect.construct(Buffer.from, ["literal"], Other));
attempt("an optional call", () => Buffer.from?.("literal"));
attempt("an optional member", () => Buffer?.from("literal"));
attempt("a comma before the call", () => (0, Buffer.from)("literal"));
attempt("a comma before the literal", () => Buffer.from((0, "after the comma")));
attempt("a computed name", () => Buffer["from"]("literal"));
attempt("Buffer called", () => Buffer("literal"));
attempt("new Buffer", () => new Buffer("6869", "hex"));
attempt("encode.call({})", () => TextEncoder.prototype.encode.call({}, "literal"));
attempt("encode.call(undefined)", () => TextEncoder.prototype.encode.call(undefined, "literal"));
attempt("encode.call(prototype)", () => TextEncoder.prototype.encode.call(TextEncoder.prototype, "literal"));
attempt("encode.call(a decoder)", () => TextEncoder.prototype.encode.call(new TextDecoder(), "literal"));
attempt("encode.call(an encoder)", () => TextEncoder.prototype.encode.call(new TextEncoder(), "literal"));
attempt("encode, detached", () => (0, new TextEncoder().encode)("literal"));
attempt("new encode", () => new (new TextEncoder().encode)("literal"));
attempt("TextEncoder called without new", () => TextEncoder().encode("literal"));
attempt("fromBase64.call(undefined)", () => Uint8Array.fromBase64.call(undefined, "aGk="));
attempt("fromBase64.call(Other)", () => Uint8Array.fromBase64.call(Other, "aGk="));
attempt("fromBase64.call(Buffer)", () => Uint8Array.fromBase64.call(Buffer, "aGk="));
attempt("Buffer.fromBase64", () => Buffer.fromBase64("aGk="));
attempt("Buffer.fromHex", () => Buffer.fromHex("6869"));
attempt("Int8Array.fromHex", () => Int8Array.fromHex("6869"));
attempt("fromHex.call(Other)", () => Uint8Array.fromHex.call(Other, "6869"));
attempt("new fromHex", () => new Uint8Array.fromHex("6869"));
attempt("of.call(Other)", () => Uint8Array.of.call(Other, 1, 2, 3));
attempt("of.call(Buffer)", () => Uint8Array.of.call(Buffer, 1, 2, 3));
attempt("of.call(undefined)", () => Uint8Array.of.call(undefined, 1, 2, 3));
attempt("of.call(Uint16Array)", () => Uint8Array.of.call(Uint16Array, 1, 2, 300));
attempt("Uint8Array called without new", () => Uint8Array([1, 2, 3]));
attempt("Reflect.construct of Uint8Array", () => Reflect.construct(Uint8Array, [[1, 2, 3]], Buffer));
attempt("Reflect.construct with another new.target", () => Reflect.construct(Uint8Array, [[1, 2, 3]], Other));
