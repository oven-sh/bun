// Window does not exist when the program starts. It is defined by a script's let.
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
const made = { mark: "made" };
function kinds() { return [typeof window, typeof globalThis.window, "window" in globalThis].join(); }
function mark() { return typeof window === "undefined" ? "missing" : window.mark; }
function read() { return typeof window.mark; }
attempt(kinds);
attempt(kinds);
attempt(mark);
attempt(read);
import vm from "node:vm";
vm.runInThisContext("let window = { mark: 'made' };");
attempt(kinds);
attempt(kinds);
attempt(mark);
attempt(read);
console.log(told.join("\n"));
