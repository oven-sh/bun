// Buffer.byteLength and the other static functions of Buffer, read in loops, while they are what they were, after one is replaced, after Buffer itself is replaced, and behind a getter.
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
const original = Buffer.byteLength;
let calls = 0;
Buffer.byteLength = function (text) { calls++; return this === Buffer ? text.length : -1; };
console.log("replaced", total(), calls);
Buffer.byteLength = original;
console.log("put back", total(), calls);
Object.defineProperty(Buffer, "byteLength", { get() { calls++; return original; }, configurable: true });
console.log("behind a getter", total(), calls);
Object.defineProperty(Buffer, "byteLength", { value: original, writable: true, configurable: true, enumerable: false });
console.log("a value again", total(), calls);
delete Buffer.byteLength;
try { total(); console.log("no error"); } catch (error) { console.log("deleted", error.constructor.name); }
Buffer.byteLength = original;
const RealBuffer = Buffer;
let reads = 0;
globalThis.Buffer = { byteLength(text) { return this === globalThis.Buffer ? 1 : -1; }, isBuffer: RealBuffer.isBuffer };
console.log("another Buffer", total());
Object.defineProperty(globalThis, "Buffer", { get() { reads++; return RealBuffer; }, configurable: true });
console.log("Buffer behind a getter", total(), reads);
Object.defineProperty(globalThis, "Buffer", { value: RealBuffer, writable: true, configurable: true, enumerable: false });
console.log("the real one again", total(), kinds(), reads);
