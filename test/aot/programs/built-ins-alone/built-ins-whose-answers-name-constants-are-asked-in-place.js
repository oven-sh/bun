// Built-ins whose rows name constants or a narrow range of integers (compare, localeCompare, clz32, the reads of DataView and Buffer, process.arch | platform, names, eventPhase, the records of allSettled, lengths), asked in place at the edges: a condition that the compiler folds by the row must be what plain Bun computes.
function show(label, ...values) { console.log(label, ...values); }
function attempt(label, run) {
  try { run(); } catch (error) { console.log(label, "throws", error.constructor.name); }
}
const isSign = value => value === -1 || value === 0 || value === 1;
attempt("Buffer.compare", () => {
  const low = Buffer.from([0, 0, 0]), high = Buffer.from([255, 255, 255, 255]), same = Buffer.from([0, 0, 0]);
  const first = Buffer.compare(low, high), second = Buffer.compare(high, low), third = Buffer.compare(low, same);
  show("Buffer.compare", first, second, third, first === -1 || first === 0 || first === 1, second === -1 || second === 0 || second === 1, first >= -1 && first <= 1);
  const fourth = low.compare(high), fifth = high.compare(low, 1, 2, 0, 4), sixth = high.compare(new Uint8Array([1]));
  show("buffer.compare", fourth, fifth, sixth, fourth === -1 || fourth === 0 || fourth === 1, fifth === -1 || fifth === 0 || fifth === 1, sixth >= -1 && sixth <= 1);
});
attempt("localeCompare", () => {
  const first = "a".localeCompare("z"), second = "z".localeCompare("a"), third = "a".localeCompare("a"), fourth = "\u{10FFFF}".localeCompare(""), fifth = "ä".localeCompare("z", "de"), sixth = "a".localeCompare("B", undefined, { sensitivity: "base" });
  show("localeCompare", first, second, third, fourth, fifth, sixth, first === -1 || first === 0 || first === 1, second === -1 || second === 0 || second === 1, fourth >= -1 && fourth <= 1, [first, second, third, fourth, fifth, sixth].every(isSign));
});
attempt("Math.clz32", () => {
  const values = [Math.clz32(0), Math.clz32(-1), Math.clz32(1), Math.clz32(NaN), Math.clz32(2 ** 32), Math.clz32(0.5), Math.clz32("8"), Math.clz32()];
  const zero = Math.clz32(0);
  show("Math.clz32", values.join(), zero >= 0 && zero <= 32, zero === 32, zero > 31);
});
attempt("DataView", () => {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, 0xffffffff);
  view.setUint32(4, 0x80008000);
  const int8 = view.getInt8(0), uint8 = view.getUint8(0), int16 = view.getInt16(4), uint16 = view.getUint16(0), little = view.getInt16(4, true);
  show("DataView", int8, uint8, int16, uint16, little, int8 >= -128 && int8 <= 127, uint8 >= 0 && uint8 <= 255, int16 >= -32768 && int16 <= 32767, uint16 >= 0 && uint16 <= 65535, uint8 === 255, int16 === -32768);
});
attempt("Buffer reads", () => {
  const buffer = Buffer.from([0xff, 0xff, 0x80, 0x00, 0x00, 0x80]);
  const int8 = buffer.readInt8(0), uint8 = buffer.readUInt8(0), int16 = buffer.readInt16BE(2), little = buffer.readInt16LE(4), uint16 = buffer.readUInt16BE(0), uint16Little = buffer.readUInt16LE(0), lower = buffer.readUint8(0), lower16 = buffer.readUint16LE(2);
  show("Buffer reads", int8, uint8, int16, little, uint16, uint16Little, lower, lower16, int8 >= -128 && int8 <= 127, uint8 <= 255, int16 >= -32768, little === -32768, uint16 <= 65535);
});
attempt("a read past the end", () => Buffer.alloc(1).readInt16BE(0));
attempt("process", () => {
  const arch = process.arch, platform = process.platform;
  show("process", arch === "arm64" || arch === "x64", platform === "android" || platform === "darwin" || platform === "freebsd" || platform === "linux" || platform === "win32", typeof arch, typeof platform, arch.length > 0);
});
attempt("names", () => {
  show("names", new TextEncoder().encoding, new TextEncoder().encoding === "utf-8", new Headers().entries()[Symbol.toStringTag], new URLSearchParams().keys()[Symbol.toStringTag], Object.prototype.toString.call(new Headers().keys()));
});
attempt("Event", () => {
  const event = new Event("x");
  const target = new EventTarget();
  let during = -1;
  target.addEventListener("x", seen => { during = seen.eventPhase; });
  target.dispatchEvent(event);
  show("Event", new Event("y").eventPhase, during, event.eventPhase, during >= 0 && during <= 65535);
});
attempt("settled records", async () => {
  const records = await Promise.allSettled([1, Promise.reject(new Error("no")), Promise.resolve(2)]);
  show("settled records", records.map(record => record.status).join(), records[0].status === "fulfilled", records[1].status === "rejected", records[1].status === "fulfilled", records.every(record => record.status === "fulfilled" || record.status === "rejected"), "value" in records[1], "reason" in records[0]);
});
attempt("numbers of the language", () => {
  show("numbers of the language", Number.MAX_SAFE_INTEGER === 9007199254740991, Number.MIN_SAFE_INTEGER === -9007199254740991, Uint8Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT, BigInt64Array.BYTES_PER_ELEMENT, new Int16Array(1).BYTES_PER_ELEMENT, Float16Array.BYTES_PER_ELEMENT);
});
attempt("lengths of functions", () => {
  function three(a, b, c) {}
  Object.defineProperty(three, "length", { value: -5 });
  const text = () => {};
  Object.defineProperty(text, "length", { value: "long" });
  show("lengths of functions", Array.length, Map.length, parseInt.length, Function.length, three.length, three.length >= 0, text.length, typeof text.length, three.bind(null).length, text.bind(null).length);
});
attempt("lengths and sizes", () => {
  const encoded = new TextEncoder().encodeInto("añ😀", new Uint8Array(3));
  show("lengths and sizes", encoded.read, encoded.written, encoded.read >= 0, Buffer.byteLength("añ😀"), Buffer.byteLength("ab", "hex"), Bun.stringWidth("añ😀"), Bun.stringWidth(""), Atomics.notify(new Int32Array(new SharedArrayBuffer(4)), 0));
  const words = new Uint32Array(new SharedArrayBuffer(8));
  words[0] = 0xffffffff;
  const signed = new Int32Array(words.buffer);
  show("Atomics", Atomics.load(words, 0), Atomics.load(signed, 0), Atomics.add(words, 0, 1), Atomics.load(words, 0), Atomics.sub(signed, 0, 1), Atomics.exchange(words, 1, 4294967295), Atomics.or(words, 1, 0), Math.imul(0xffffffff, 5), Math.imul(2 ** 31, 1));
});
