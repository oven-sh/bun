// A constructor function gets a new object as its prototype, and its members are stored through another name for that object. Classes below it read those members as values and call them.
function Emitter() {
  this.count = 0;
}
const EmitterPrototype = (Emitter.prototype = {});
EmitterPrototype.constructor = Emitter;
EmitterPrototype.listeners = undefined;
EmitterPrototype.limit = 10;
EmitterPrototype.emit = function emit(value) {
  this.count += value;
  return this.listeners !== undefined;
};
const emit = EmitterPrototype.emit;
function Stream(name) {
  Emitter.call(this);
  this.name = name;
  this.ended = false;
  this.size = 0;
}
Object.setPrototypeOf(Stream.prototype, Emitter.prototype);
Object.setPrototypeOf(Stream, Emitter);
function isUnheard(stream) {
  if (stream.emit !== emit) return false;
  if (stream.listeners !== undefined) return false;
  return stream.count < stream.limit * 1000000 && !stream.ended && stream.size === 0 && stream.name.length > 0;
}
globalThis.kept = [Emitter, Stream, isUnheard];
const streams = [new Stream("a"), new Stream("bc"), new Stream("def")];
const rounds = Number(process.argv[2] ?? 1000);
let sum = 0;
for (let i = 0; i < rounds; i++) {
  const stream = streams[i % 3];
  if (isUnheard(stream)) sum += 1;
  stream.emit(1);
}
console.log(sum, streams[0].count, streams[2].count);
