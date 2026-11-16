function Stream() { this.open = true; }
function Readable() { Stream.call(this); this.size = 1; }
Object.setPrototypeOf(Readable.prototype, Stream.prototype);
Object.setPrototypeOf(Readable, Stream);
function Other() { this.n = 2; }
function isStream(val) { return val instanceof Stream; }
function isReadable(val) { return val instanceof Readable; }
const all = [new Readable(), new Stream(), new Other(), "text", null, undefined, 7];
console.log(all.map(isStream).join(), all.map(isReadable).join());
