// The native object behind a ServerResponse has no public name: a program reaches it only through a symbol of the library. Under --aot its prototype is locked like a built-in's: whoever replaces, adds, deletes or re-parents there is refused loudly, and the server goes on answering. The object itself stays free: an own property hides the prototype's member, for the library too.
"use strict";
const http = require("node:http");
const lines = [];
const attempt = (label, action) => { try { lines.push(label + ": " + String(action())); } catch (error) { lines.push(label + ": throws " + error.name); } };
let round = 0;
const server = http.createServer((req, res) => {
  const key = Object.getOwnPropertySymbols(res).find(symbol => symbol.description === "handle");
  const handle = res[key], prototype = Object.getPrototypeOf(handle);
  if (round++ === 0) {
    lines.push("members: " + ["end", "finished", "flags", "onabort", "ondata", "write", "writeHead"].filter(name => Object.hasOwn(prototype, name)).join());
    const flags = Object.getOwnPropertyDescriptor(prototype, "flags"), end = prototype.end;
    attempt("define a getter", () => Object.defineProperty(prototype, "flags", { get() { return 0; } }) === prototype);
    attempt("define the same getter", () => Object.defineProperty(prototype, "flags", flags) === prototype);
    attempt("Reflect.defineProperty", () => Reflect.defineProperty(prototype, "finished", { get() { return true; } }));
    attempt("store a method", () => { prototype.end = function () { return -1; }; return prototype.end === end; });
    attempt("store the same method", () => { prototype.end = end; return prototype.end === end; });
    attempt("Reflect.set", () => Reflect.set(prototype, "write", () => 0));
    attempt("delete a member", () => delete prototype.cork);
    attempt("Reflect.deleteProperty", () => Reflect.deleteProperty(prototype, "writeHead"));
    attempt("add a name", () => { prototype.added = 1; return "added" in prototype; });
    attempt("another parent", () => Object.setPrototypeOf(prototype, null) === prototype);
    attempt("the same parent", () => Object.setPrototypeOf(prototype, Object.getPrototypeOf(prototype)) === prototype);
    attempt("Reflect.setPrototypeOf", () => Reflect.setPrototypeOf(prototype, {}));
    attempt("Object.assign", () => Object.assign(prototype, { abort() {} }) === prototype);
    attempt("as it was", () => Object.getOwnPropertyDescriptor(prototype, "flags").get === flags.get && prototype.end === end && "cork" in prototype && "writeHead" in prototype);
  } else if (round === 2) {
    let reads = 0; const finished = Object.getOwnPropertyDescriptor(prototype, "finished").get;
    Object.defineProperty(handle, "finished", { get() { reads++; return finished.call(this); }, configurable: true });
    handle.note = "own";
    res.on("finish", () => lines.push("an own getter on the object is read by the library: " + (reads > 0) + " " + handle.note));
  } else if (round === 3) {
    const between = Object.create(prototype, { bufferedAmount: { get() { return 0; } } });
    attempt("the object gets another parent", () => Object.setPrototypeOf(handle, between) === handle && handle.bufferedAmount === 0 && typeof handle.flags === "number");
  }
  res.setHeader("x-round", String(round)); res.end("answer " + round);
});
server.listen(0, "127.0.0.1", async () => {
  for (let i = 0; i < 6; i++) await new Promise(resolve => http.get({ port: server.address().port, host: "127.0.0.1", agent: false }, res => { let text = ""; res.setEncoding("utf8"); res.on("data", chunk => (text += chunk)); res.on("end", () => { lines.push(res.statusCode + " " + res.headers["x-round"] + " " + text); resolve(); }); }));
  server.close(() => console.log(lines.join("\n")));
});
/* Output:
members: end,finished,flags,onabort,ondata,write,writeHead
define a getter: throws TypeError
define the same getter: true
Reflect.defineProperty: false
store a method: throws TypeError
store the same method: true
Reflect.set: false
delete a member: throws TypeError
Reflect.deleteProperty: false
add a name: throws TypeError
another parent: throws TypeError
the same parent: true
Reflect.setPrototypeOf: false
Object.assign: throws TypeError
as it was: true
200 1 answer 1
an own getter on the object is read by the library: true own
200 2 answer 2
the object gets another parent: true
200 3 answer 3
200 4 answer 4
200 5 answer 5
200 6 answer 6
*/
