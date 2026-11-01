// A StringDecoder: what its constructor, its three methods and its four getters answer, for whole and for split characters, for other receivers and refused operands.
import { StringDecoder } from "node:string_decoder";
const say = (...values: unknown[]) => console.log(...values);
function caught(run: () => unknown): unknown {
  try { return run(); } catch (e) { return `${(e as any).code ?? (e as Error).name}: ${(e as Error).message}`; }
}
interface WithState { lastNeed: number; lastTotal: number; lastChar: Buffer; encoding: string; }
const decoder = new StringDecoder("utf8") as StringDecoder & WithState;
const euro = Buffer.from("€");
say(decoder.write(euro.subarray(0, 1)).length, decoder.lastNeed + 0, decoder.lastTotal + 0, decoder.lastChar.length, decoder.lastChar instanceof Buffer, decoder.lastChar === decoder.lastChar);
say(decoder.write(euro.subarray(1)), decoder.end().length, decoder.encoding.toUpperCase(), decoder.write("already text" as any).toUpperCase());
say(decoder.end(Buffer.from("tail")), (decoder as any).text(Buffer.from("offset"), 3), (decoder as any).text(Buffer.from("offset"), { valueOf() { say("the offset is converted"); return 1; } }));
say((new StringDecoder() as StringDecoder & WithState).encoding, new StringDecoder("hex").write(Buffer.from([1, 255])), new StringDecoder("base64").end(Buffer.from("ab")), new StringDecoder("utf16le").write(new Uint8Array([97, 0])), new StringDecoder("latin1").write(new DataView(new ArrayBuffer(1))).length);
say(caught(() => new StringDecoder("nope" as any)), caught(() => (new StringDecoder({ toString() { say("the encoding is converted"); return "ascii"; } } as any) as StringDecoder & WithState).encoding));
say(caught(() => decoder.write({} as any)), caught(() => decoder.write(undefined as any)), caught(() => (decoder.write as any)()), caught(() => decoder.end(1 as any)), caught(() => (decoder as any).text(Buffer.alloc(1))));
say(caught(() => StringDecoder.prototype.write.call({}, euro)), caught(() => (Object.getOwnPropertyDescriptor(StringDecoder.prototype, "lastNeed")!.get as any).call(1)));
class Louder extends StringDecoder { write(buffer: Buffer) { return super.write(buffer).toUpperCase(); } }
say(new Louder().write(Buffer.from("louder")), new Louder() instanceof StringDecoder, Object.getPrototypeOf(new Louder()) === Louder.prototype);
// undefined and null are refused before an operand is looked at or converted.
const neverConverted = { valueOf() { say("never run"); return 0; } };
for (const nothing of [undefined, null])
  say(caught(() => StringDecoder.prototype.write.call(nothing as any, 1 as any)), caught(() => StringDecoder.prototype.end.call(nothing as any, 1 as any)), caught(() => (StringDecoder.prototype as any).text.call(nothing, euro, neverConverted)), caught(() => (Object.getOwnPropertyDescriptor(StringDecoder.prototype, "encoding")!.get as any).call(nothing)), caught(() => Buffer.prototype.toJSON.call(nothing as any)));
function Borrowing(this: any, encoding: string) { (StringDecoder as any).call(this, encoding); }
Borrowing.prototype = Object.create(StringDecoder.prototype);
const borrowed = new (Borrowing as any)("utf8");
say(borrowed.write(euro), borrowed.encoding, borrowed instanceof StringDecoder, Object.keys(borrowed).join());
say(typeof (StringDecoder as any)("hex").write, StringDecoder.prototype.constructor === StringDecoder, Object.getOwnPropertyNames(StringDecoder.prototype).sort().join());
