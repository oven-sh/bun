// A CommonJS module that only makes values exports them in a literal, and the module that gathers the package hands that object out at its end. What the package's modules took out of the object at their top level, ahead of that, is what the literal was made with: symbols among it are names for as long as the module that took them out has not failed: that is tested where they are used, and a module that failed and was evaluated again goes by key. What is taken out later, or by a module that may be evaluated by another road, is not. Where it is the one symbol or undefined, under a handler, the key is tested for the symbol, and behind the test it is a name.
// IR= 2 write PropGet v[0-9]+ name=UniqueSymbol "[^"]*mini\.stream"
// IR= 1 info PropGet v[0-9]+ name=UniqueSymbol "[^"]*mini\.write"
// IR= 1 mini PropSet v[0-9]+, v[0-9]+ name=UniqueSymbol "[^"]*mini\.stream"
// IR= 1 readLate ElemGet
// IR= 1 readByAnotherRoad ElemGet
// IR= 1 readOfStoredTo ElemGet
// IR= 0 readUnderAHandler ElemGet
// IR= 1 readUnderAHandler TypeTest v[0-9]+ testedType=symbol\("handled"\)
// IR= 1 readInACycle ElemGet
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
