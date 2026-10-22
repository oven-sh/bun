// A store to an accessor of the host runs its setter, which keeps what it is handed: native code reads it back or calls it later. A store to a data property that native code looks up later is found by it too.
// The receivers and the keys come in ways that the compiler follows and in ways that it does not.
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + (error.code ? " " + error.code : "")); }
}
const words = JSON.parse(process.argv[2] ?? `{ "title": "title", "proto": "__proto__", "prepare": "prepareStackTrace", "emit": "emit", "onmessage": "onmessage", "href": "href", "exitCode": "exitCode" }`);
const hidden = value => new Proxy({ value }, {}).value;

attempt("process.title", () => { process.title = "named"; return process.title; });
attempt("process[title]", () => { process[words.title] = "computed"; return process.title; });
attempt("hidden(process)[title]", () => { hidden(process)[words.title] = "hidden"; return process.title; });

let prepared = 0;
attempt("Error.prepareStackTrace", () => { Error.prepareStackTrace = (error, frames) => { prepared++; return "named " + Array.isArray(frames); }; return new Error("x").stack; });
attempt("Error[prepareStackTrace]", () => { Error[words.prepare] = (error, frames) => { prepared++; return "computed " + Array.isArray(frames); }; return new Error("x").stack; });
attempt("hidden(Error)[prepareStackTrace]", () => { hidden(Error)[words.prepare] = (error, frames) => { prepared++; return "hidden " + Array.isArray(frames); }; return new Error("x").stack; });
attempt("calls of the three", () => prepared);
Error.prepareStackTrace = undefined;

class Above { greet() { return "from above " + this.name; } }
attempt("__proto__", () => { const object = { name: "named" }; object.__proto__ = Above.prototype; return object.greet(); });
attempt("[__proto__]", () => { const object = { name: "computed" }; object[words.proto] = Above.prototype; return object.greet(); });
attempt("hidden()[__proto__]", () => { const object = { name: "hidden" }; hidden(object)[words.proto] = Above.prototype; return object.greet(); });

attempt("URL.href", () => { const url = new URL("http://a/b"); url.href = "http://named/"; return url.host; });
attempt("URL[href]", () => { const url = new URL("http://a/b"); url[words.href] = "http://computed/"; return url.host; });
attempt("hidden(URL)[href]", () => { const url = new URL("http://a/b"); hidden(url)[words.href] = "http://hidden/"; return url.host; });

let emitted = [];
attempt("process[emit]", () => { const emit = process.emit; process[words.emit] = function (name, ...rest) { emitted.push(String(name)); return emit.call(this, name, ...rest); }; process.emit("mine"); return emitted.join(); });
attempt("process[exitCode]", () => { process[words.exitCode] = 3; const seen = process.exitCode; process.exitCode = 0; return seen; });

const channel = new MessageChannel();
let got = [];
channel.port1[words.onmessage] = event => { got.push("computed " + event.data); channel.port1.close(); channel.port2.close(); print("what native code called: " + got.join()); print("events that native code emitted through the stored emit: " + emitted.filter(name => name === "beforeExit" || name === "exit").length); };
channel.port2.postMessage("sent");
process.on("exit", () => print("at exit: " + emitted.filter(name => name === "exit").join()));
