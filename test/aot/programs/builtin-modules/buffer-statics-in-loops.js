// Buffer.byteLength and the other static functions of Buffer, read in loops, while Buffer is what it was, after another object takes its place on the global object, and behind a getter.
const texts = ["abc", "héllo", "日本語", "", "😀"];
function total() {
  let sum = 0;
  for (let i = 0; i < 200; i++) sum += Buffer.byteLength(texts[i % texts.length], "utf8");
  return sum;
}
function kinds() {
  let seen = 0;
  for (let i = 0; i < 200; i++) seen += (Buffer.isBuffer(texts) ? 1 : 0) + Buffer.from(texts[i % texts.length]).length + Buffer.alloc(i & 3).length + Buffer.concat([Buffer.allocUnsafe(1), Buffer.allocUnsafe(2)]).length + (Buffer.isEncoding("utf8") ? 1 : 0) + Buffer.compare(Buffer.from("a"), Buffer.from("b"));
  return seen;
}
console.log("as made", total(), kinds());
console.log("again", total(), kinds());
const RealBuffer = Buffer;
let reads = 0;
globalThis.Buffer = { byteLength(text) { return this === globalThis.Buffer ? 1 : -1; }, isBuffer: RealBuffer.isBuffer };
console.log("another Buffer", total());
Object.defineProperty(globalThis, "Buffer", { get() { reads++; return RealBuffer; }, configurable: true });
console.log("Buffer behind a getter", total(), reads);
Object.defineProperty(globalThis, "Buffer", { value: RealBuffer, writable: true, configurable: true, enumerable: false });
console.log("the real one again", total(), kinds(), reads);
