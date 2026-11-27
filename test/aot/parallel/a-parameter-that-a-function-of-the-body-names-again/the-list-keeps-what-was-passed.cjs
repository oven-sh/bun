// A function declaration in the body bears the name of a parameter. JavaScriptCore keeps two variables then: the arguments object holds what was passed,
// the name holds the function, and a store to one does not reach the other. (By the language the two are one variable, and other engines answer so.)
function writtenIndex(given) { function given() { return 7; } return typeof arguments[0] + " " + typeof given; }
function sliced(given, next) { function given() { return 7; } return Array.prototype.slice.call(arguments).map(each => typeof each).join(); }
function spread(given, next) { function given() { return 7; } return [...arguments].map(each => typeof each).join(); }
function keyOutOfVariable(given, key) { function given() { return 7; } return typeof arguments[key]; }
function handedOn(given) { function given() { return 7; } return firstOf(arguments); }
function firstOf(list) { return typeof list[0]; }
function storedThroughList(given) { function given() { return 7; } arguments[0] = "text"; return typeof given + " " + typeof arguments[0]; }
function storedThroughName(given) { function given() { return 7; } given = "text"; return typeof given + " " + typeof arguments[0]; }
function strict(given) { "use strict"; function given() { return 7; } return typeof arguments[0] + " " + typeof given; }
function besideDefault(given, next = 1) { function given() { return 7; } return typeof arguments[0] + " " + typeof given; }
function namedAgainByVar(given) { var given; return typeof arguments[0] + " " + typeof given; }
function storedByVar(given) { var given = "text"; return typeof arguments[0] + " " + typeof given; }
function secondOfTwo(first, given) { function given() { return 7; } return typeof arguments[0] + " " + typeof arguments[1] + " " + arguments.length; }
function notPassed(first, given) { function given() { return 7; } return typeof arguments[1] + " " + arguments.length + " " + typeof given; }
function insideBlock(given) { { function given() { return 7; } } return typeof arguments[0] + " " + typeof given; }
function storedBesideBlock(given) { { function given() { return 7; } } arguments[0] = "text"; return typeof given + " " + typeof arguments[0]; }
function storedBehindIf(given, next) { if (next) { function given() { return 7; } } given = "text"; return typeof given + " " + typeof arguments[0]; }
console.log("writtenIndex", writtenIndex(1));
console.log("sliced", sliced(1, 2));
console.log("spread", spread(1, 2));
console.log("keyOutOfVariable", keyOutOfVariable(1, 0));
console.log("handedOn", handedOn(1));
console.log("storedThroughList", storedThroughList(1));
console.log("storedThroughName", storedThroughName(1));
console.log("strict", strict(1));
console.log("besideDefault", besideDefault(1));
console.log("namedAgainByVar", namedAgainByVar(1));
console.log("storedByVar", storedByVar(1));
console.log("secondOfTwo", secondOfTwo(1, 2));
console.log("notPassed", notPassed(1));
console.log("insideBlock", insideBlock(1));
console.log("storedBesideBlock", storedBesideBlock(1));
console.log("storedBehindIf", storedBehindIf(1, 0), storedBehindIf(1, 1));
