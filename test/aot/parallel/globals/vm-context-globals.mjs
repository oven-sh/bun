// A vm context has its own globals.
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
globalThis.place = "the realm of the program";
function read() { return place; }
function kind() { return typeof place; }
function store(value) { place = value; }
const context = vm.createContext({ read, kind, store, place: "the context" });
attempt(read);
attempt(() => vm.runInContext("place + ' / ' + read() + ' / ' + kind()", context));
attempt(() => vm.runInContext("place = 'changed in the context'; read()", context));
attempt(() => vm.runInContext("store('stored from the context'); place", context));
attempt(read);
attempt(() => context.place);
console.log(told.join("\n"));
