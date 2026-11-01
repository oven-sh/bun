// The dead zone of a script's let.
const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
const told = [];
function attempt(action) {
  try {
    told.push(String(action()));
  } catch (error) {
    told.push(error instanceof TypeError ? error.name : error.name + ": " + error.message);
  }
}
import vm from "node:vm";
function read() { return pending; }
function kind() { return typeof pending; }
function readNever() { return never; }
function kindOfNever() { return typeof never; }
globalThis.readPending = read;
globalThis.readNever = readNever;
attempt(kind);
attempt(read);
attempt(() => vm.runInThisContext("var seen = []; try { seen.push(readPending()); } catch (error) { seen.push(error.name + ': ' + error.message); } let pending = 'ready'; seen.push(readPending()); seen.join(' | ')"));
attempt(read);
attempt(kind);
attempt(kindOfNever);
attempt(() => vm.runInThisContext("readNever(); let never = 1;"));
attempt(readNever);
attempt(readNever);
attempt(kindOfNever);
console.log(told.join("\n"));
