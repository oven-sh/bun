const first = require("./replaces-in-a-cycle.cjs");
exports.sawType = typeof first;
exports.sawKeys = Object.keys(first).join();
exports.readFirst = () => [first.early, first.afterwards, first.partner, Object.keys(first).join()].join("|");
exports.readAgain = () => require("./replaces-in-a-cycle.cjs");
exports.entryPoint = require("./main.cjs");
exports.keysOfTheEntryPoint = Object.keys(exports.entryPoint).join();
exports.entryPoint.storedByPartner = "stored by partner";
