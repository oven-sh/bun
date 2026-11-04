import { Buffer as BufferOfModule, SlowBuffer, Blob as BlobOfModule, File as FileOfModule } from "node:buffer";
const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isBuffer(x) { return x instanceof Buffer; }
function countBuffer(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Buffer) count++; } return count; }
function isBufferOfModule(x) { return x instanceof BufferOfModule; }
function countBufferOfModule(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof BufferOfModule) count++; } return count; }
function isSlowBuffer(x) { return x instanceof SlowBuffer; }
function countSlowBuffer(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof SlowBuffer) count++; } return count; }
function isUint8Array(x) { return x instanceof Uint8Array; }
function countUint8Array(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Uint8Array) count++; } return count; }
function isBlobOfModule(x) { return x instanceof BlobOfModule; }
function countBlobOfModule(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof BlobOfModule) count++; } return count; }
function isFileOfModule(x) { return x instanceof FileOfModule; }
function countFileOfModule(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof FileOfModule) count++; } return count; }
function isBlob(x) { return x instanceof Blob; }
function countBlob(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Blob) count++; } return count; }
function isFile(x) { return x instanceof File; }
function countFile(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof File) count++; } return count; }
const tests = [["Buffer", isBuffer, countBuffer], ["BufferOfModule", isBufferOfModule, countBufferOfModule], ["SlowBuffer", isSlowBuffer, countSlowBuffer], ["Uint8Array", isUint8Array, countUint8Array], ["BlobOfModule", isBlobOfModule, countBlobOfModule], ["FileOfModule", isFileOfModule, countFileOfModule], ["Blob", isBlob, countBlob], ["File", isFile, countFile]];
const values = [];
maybe("created below Buffer.prototype", () => Object.create(Buffer.prototype), values);
maybe("Buffer.prototype", () => Buffer.prototype, values);
maybe("Buffer", () => Buffer, values);
maybe("new Buffer", () => new Buffer(2), values);
maybe("new of a class below Buffer", () => new (class extends Buffer {})(2), values);
maybe("new Buffer without its prototype", () => Object.setPrototypeOf(new Buffer(2), null), values);
maybe("new Buffer below BufferOfModule.prototype", () => Object.setPrototypeOf(new Buffer(2), BufferOfModule.prototype), values);
maybe("a proxy of new Buffer", () => new Proxy(new Buffer(2), {}), values);
maybe("Buffer made for BufferOfModule as new.target", () => Reflect.construct(Buffer, [2], BufferOfModule), values);
maybe("created below BufferOfModule.prototype", () => Object.create(BufferOfModule.prototype), values);
maybe("BufferOfModule.prototype", () => BufferOfModule.prototype, values);
maybe("BufferOfModule", () => BufferOfModule, values);
maybe("new BufferOfModule", () => new BufferOfModule(2), values);
maybe("new of a class below BufferOfModule", () => new (class extends BufferOfModule {})(2), values);
maybe("new BufferOfModule without its prototype", () => Object.setPrototypeOf(new BufferOfModule(2), null), values);
maybe("new BufferOfModule below SlowBuffer.prototype", () => Object.setPrototypeOf(new BufferOfModule(2), SlowBuffer.prototype), values);
maybe("a proxy of new BufferOfModule", () => new Proxy(new BufferOfModule(2), {}), values);
maybe("BufferOfModule made for SlowBuffer as new.target", () => Reflect.construct(BufferOfModule, [2], SlowBuffer), values);
maybe("created below SlowBuffer.prototype", () => Object.create(SlowBuffer.prototype), values);
maybe("SlowBuffer.prototype", () => SlowBuffer.prototype, values);
maybe("SlowBuffer", () => SlowBuffer, values);
maybe("new SlowBuffer", () => new SlowBuffer(2), values);
maybe("new of a class below SlowBuffer", () => new (class extends SlowBuffer {})(2), values);
maybe("new SlowBuffer without its prototype", () => Object.setPrototypeOf(new SlowBuffer(2), null), values);
maybe("new SlowBuffer below Uint8Array.prototype", () => Object.setPrototypeOf(new SlowBuffer(2), Uint8Array.prototype), values);
maybe("a proxy of new SlowBuffer", () => new Proxy(new SlowBuffer(2), {}), values);
maybe("SlowBuffer made for Uint8Array as new.target", () => Reflect.construct(SlowBuffer, [2], Uint8Array), values);
maybe("created below Uint8Array.prototype", () => Object.create(Uint8Array.prototype), values);
maybe("Uint8Array.prototype", () => Uint8Array.prototype, values);
maybe("Uint8Array", () => Uint8Array, values);
maybe("new Uint8Array", () => new Uint8Array(2), values);
maybe("new of a class below Uint8Array", () => new (class extends Uint8Array {})(2), values);
maybe("new Uint8Array without its prototype", () => Object.setPrototypeOf(new Uint8Array(2), null), values);
maybe("new Uint8Array below BlobOfModule.prototype", () => Object.setPrototypeOf(new Uint8Array(2), BlobOfModule.prototype), values);
maybe("a proxy of new Uint8Array", () => new Proxy(new Uint8Array(2), {}), values);
maybe("Uint8Array made for BlobOfModule as new.target", () => Reflect.construct(Uint8Array, [2], BlobOfModule), values);
maybe("created below BlobOfModule.prototype", () => Object.create(BlobOfModule.prototype), values);
maybe("BlobOfModule.prototype", () => BlobOfModule.prototype, values);
maybe("BlobOfModule", () => BlobOfModule, values);
maybe("new BlobOfModule", () => new BlobOfModule(["a"]), values);
maybe("new of a class below BlobOfModule", () => new (class extends BlobOfModule {})(["a"]), values);
maybe("new BlobOfModule without its prototype", () => Object.setPrototypeOf(new BlobOfModule(["a"]), null), values);
maybe("new BlobOfModule below FileOfModule.prototype", () => Object.setPrototypeOf(new BlobOfModule(["a"]), FileOfModule.prototype), values);
maybe("a proxy of new BlobOfModule", () => new Proxy(new BlobOfModule(["a"]), {}), values);
maybe("BlobOfModule made for FileOfModule as new.target", () => Reflect.construct(BlobOfModule, [["a"]], FileOfModule), values);
maybe("created below FileOfModule.prototype", () => Object.create(FileOfModule.prototype), values);
maybe("FileOfModule.prototype", () => FileOfModule.prototype, values);
maybe("FileOfModule", () => FileOfModule, values);
maybe("new FileOfModule", () => new FileOfModule(["a"], "a.txt"), values);
maybe("new of a class below FileOfModule", () => new (class extends FileOfModule {})(["a"], "a.txt"), values);
maybe("new FileOfModule without its prototype", () => Object.setPrototypeOf(new FileOfModule(["a"], "a.txt"), null), values);
maybe("new FileOfModule below Blob.prototype", () => Object.setPrototypeOf(new FileOfModule(["a"], "a.txt"), Blob.prototype), values);
maybe("a proxy of new FileOfModule", () => new Proxy(new FileOfModule(["a"], "a.txt"), {}), values);
maybe("FileOfModule made for Blob as new.target", () => Reflect.construct(FileOfModule, [["a"], "a.txt"], Blob), values);
maybe("created below Blob.prototype", () => Object.create(Blob.prototype), values);
maybe("Blob.prototype", () => Blob.prototype, values);
maybe("Blob", () => Blob, values);
maybe("new Blob", () => new Blob(["a"]), values);
maybe("new of a class below Blob", () => new (class extends Blob {})(["a"]), values);
maybe("new Blob without its prototype", () => Object.setPrototypeOf(new Blob(["a"]), null), values);
maybe("new Blob below File.prototype", () => Object.setPrototypeOf(new Blob(["a"]), File.prototype), values);
maybe("a proxy of new Blob", () => new Proxy(new Blob(["a"]), {}), values);
maybe("Blob made for File as new.target", () => Reflect.construct(Blob, [["a"]], File), values);
maybe("created below File.prototype", () => Object.create(File.prototype), values);
maybe("File.prototype", () => File.prototype, values);
maybe("File", () => File, values);
maybe("new File", () => new File(["a"], "a.txt"), values);
maybe("new of a class below File", () => new (class extends File {})(["a"], "a.txt"), values);
maybe("new File without its prototype", () => Object.setPrototypeOf(new File(["a"], "a.txt"), null), values);
maybe("new File below Buffer.prototype", () => Object.setPrototypeOf(new File(["a"], "a.txt"), Buffer.prototype), values);
maybe("a proxy of new File", () => new Proxy(new File(["a"], "a.txt"), {}), values);
maybe("File made for Buffer as new.target", () => Reflect.construct(File, [["a"], "a.txt"], Buffer), values);
maybe(`Buffer.from("ab")`, () => (Buffer.from("ab")), values);
maybe(`BufferOfModule.from("ab")`, () => (BufferOfModule.from("ab")), values);
maybe("SlowBuffer(2)", () => (SlowBuffer(2)), values);
maybe("Buffer.alloc(2)", () => (Buffer.alloc(2)), values);
maybe("Buffer.allocUnsafeSlow(2)", () => (Buffer.allocUnsafeSlow(2)), values);
maybe("Buffer.concat([])", () => (Buffer.concat([])), values);
maybe(`Buffer.from("ab").subarray(1)`, () => (Buffer.from("ab").subarray(1)), values);
maybe(`Buffer.from("ab").slice(1)`, () => (Buffer.from("ab").slice(1)), values);
maybe("new Uint8Array(2).subarray(1)", () => (new Uint8Array(2).subarray(1)), values);
maybe(`Bun.file("no-such-file.txt")`, () => (Bun.file("no-such-file.txt")), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Buffer: " + (Buffer[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Buffer, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Buffer, value))) + show(attempt(() => Buffer[Symbol.hasInstance](value)))).join(""));
report("BufferOfModule: " + (BufferOfModule[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(BufferOfModule, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(BufferOfModule, value))) + show(attempt(() => BufferOfModule[Symbol.hasInstance](value)))).join(""));
report("SlowBuffer: " + (SlowBuffer[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(SlowBuffer, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(SlowBuffer, value))) + show(attempt(() => SlowBuffer[Symbol.hasInstance](value)))).join(""));
report("Uint8Array: " + (Uint8Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Uint8Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Uint8Array, value))) + show(attempt(() => Uint8Array[Symbol.hasInstance](value)))).join(""));
report("BlobOfModule: " + (BlobOfModule[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(BlobOfModule, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(BlobOfModule, value))) + show(attempt(() => BlobOfModule[Symbol.hasInstance](value)))).join(""));
report("FileOfModule: " + (FileOfModule[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(FileOfModule, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(FileOfModule, value))) + show(attempt(() => FileOfModule[Symbol.hasInstance](value)))).join(""));
report("Blob: " + (Blob[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Blob, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Blob, value))) + show(attempt(() => Blob[Symbol.hasInstance](value)))).join(""));
report("File: " + (File[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(File, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(File, value))) + show(attempt(() => File[Symbol.hasInstance](value)))).join(""));
process.exit(0);
