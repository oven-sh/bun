// A class at the top level of a CommonJS file is created before the file's other statements, as under `bun run`. Its members read constants of the file that are initialized after that.
const calls = [];
let count = 0;
class Recorder {
  note(value) { calls.push(value); return ++count; }
  get size() { return calls.length; }
  set last(value) { calls[calls.length - 1] = value; }
  static create() { calls.push("created"); return new Recorder(); }
}
const recorder = Recorder.create();
console.log(recorder.note("a"), recorder.size);
recorder.last = "b";
console.log(calls.join(), count);

function early() {
  try {
    return typeof Later + " " + new Later().read();
  } catch (error) {
    return error.name;
  }
}
console.log(early());
const late = "late";
class Later { read() { return late; } }
console.log(early());

const base = class {};
class Heir extends base { read() { return late + calls.length; } }
console.log(new Heir().read());
