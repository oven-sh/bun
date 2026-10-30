// A constructor function is an object from the start of its module: what is stored on it and on its prototype object there is read back there, before anything is constructed.
function Stream() {
  this.kind = "stream";
}
function Readable() {
  Stream.call(this);
}
Object.setPrototypeOf(Readable.prototype, Stream.prototype);
Object.setPrototypeOf(Readable, Stream);
Stream.Readable = Readable;
Stream.Stream = Stream;
Stream.version = 3;
const operators = {
  map() {
    return "map of " + this.kind;
  },
  filter() {
    return "filter of " + this.kind;
  },
};
for (const key of Object.keys(operators)) {
  const operator = operators[key];
  function method(...args) {
    return operator.apply(this, args);
  }
  Object.defineProperty(method, "name", { value: operator.name });
  Object.defineProperty(Stream.Readable.prototype, key, { value: method, enumerable: false, configurable: true, writable: true });
}
console.log(typeof Stream.Readable, typeof Stream.Readable.prototype, Stream.Readable.prototype === Readable.prototype, Stream.Stream === Stream, Stream.version, Readable.version);
console.log(Object.getOwnPropertyNames(Stream.Readable.prototype).join(), Readable.prototype.map.name, Readable.prototype.constructor === Readable);
console.log(Object.getPrototypeOf(Readable.prototype) === Stream.prototype, Readable.name, Readable.length, Stream.Readable.Readable === Readable);
const readable = new Stream.Readable();
console.log(readable.map(), readable.filter(), readable instanceof Stream, readable.constructor === Readable);
Stream.Readable.prototype.map = function () {
  return "replaced";
};
console.log(readable.map(), new Readable().map(), Stream.Readable.prototype.map.name);
