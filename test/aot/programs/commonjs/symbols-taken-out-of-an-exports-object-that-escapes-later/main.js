// A CommonJS module that only makes values exports them in a literal, and the module that gathers the package hands that object out at its end. What the package's modules took out of the object at their top level, ahead of that, is what the literal was made with: symbols among it are names. What is taken out later, or by a module that may be evaluated by another road, is not.
// IR= 0 write GetByVal
// IR= 0 info GetByVal
// IR= 0 mini PutByVal
// IR= 1 readLate GetByVal
// IR= 1 readByAnotherRoad GetByVal
// IR= 1 readOfStoredTo GetByVal
// IR= 1 readUnderAHandler GetByVal
// IR= 1 readInACycle GetByVal
"use strict";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
const mini = require("./mini");
const logger = mini();
let total = 0;
for (let i = 0; i < 300; i++) total += logger.info("line " + i);
show("total", total);
show("the object that was handed out", [Object.keys(mini.symbols).join(), logger[mini.symbols.streamSym].length, mini.symbols === require("./symbols")].join());
const before = mini.symbols.streamSym;
mini.symbols.streamSym = Symbol("replaced");
show("stored to from outside", [logger.info("one more"), typeof logger[mini.symbols.streamSym], logger[before].length, mini.readLate(logger) === undefined, require("./another-road").readByAnotherRoad(logger) === undefined].join());
const storedTo = require("./stored-to-user");
show("a literal that its user stores to at once", [storedTo.readOfStoredTo({ [storedTo.first]: "first", [storedTo.second]: "second" })].join());
const underAHandler = require("./gathers-under-a-handler");
show("gathered under a handler", [underAHandler.user.readUnderAHandler({ [underAHandler.keys.kHandled]: "handled" }), Object.keys(underAHandler.keys).join()].join());
const inACycle = require("./gathers-in-a-cycle");
show("gathered in a cycle", [inACycle.user.readInACycle({ [inACycle.keys.kCycle]: "cycle" }), inACycle.user.seen].join());
console.log(lines.join("\n"));
