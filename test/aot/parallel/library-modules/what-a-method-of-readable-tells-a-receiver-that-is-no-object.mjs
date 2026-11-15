// A method or an accessor of Readable that is called on what is no object throws a TypeError whose message quotes the text that was evaluated: `this._readableState`.
// A message is an answer: what was compiled ahead of time quotes the same text as plain.
import { Readable } from "node:stream";
for (const name of ["push", "unshift", "isPaused", "resume", "pause"])
  try {
    Readable.prototype[name].call(undefined);
    console.log(name, "taken");
  } catch (e) {
    console.log(name, e.message);
  }
for (const name of ["readable", "destroyed"])
  try {
    Object.getOwnPropertyDescriptor(Readable.prototype, name).get.call(undefined);
    console.log(name, "taken");
  } catch (e) {
    console.log(name, e.message);
  }
