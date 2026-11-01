// In sloppy code a parameter and the element of `arguments` at its position are one variable. A function that only reads members and elements of the object
// and stores to no parameter is compiled without that tie. Every function here does one thing more, in one way each, and holds the parameter in a closure too.
var lines = [];
function say(name, value) {
  lines.push(name + ": " + value);
}
function both(read, first) {
  return read() + " " + first;
}
function storeInto(list, value) {
  list[0] = value;
}
function storesIntoThis() {
  this[0] = "by this";
}
function tag() {
  this[0] = "by a tag";
}

function elementStored(first) { var read = function () { return first; }; arguments[0] = "stored"; return both(read, first); }
function elementStoredByKey(first, key) { var read = function () { return first; }; arguments[key] = "by key"; return both(read, first); }
function elementCounted(first) { var read = function () { return first; }; arguments[0]++; return both(read, first); }
function elementAddedTo(first) { var read = function () { return first; }; arguments[0] += "!"; return both(read, first); }
function elementOfPattern(first) { var read = function () { return first; }; [arguments[0]] = ["pattern"]; return both(read, first); }
function elementOfObjectPattern(first) { var read = function () { return first; }; ({ a: arguments[0] } = { a: "object pattern" }); return both(read, first); }
function elementOfRest(first) { var read = function () { return first; }; [...arguments[0]] = "ab"; return both(read, first); }
function elementOfForIn(first) { var read = function () { return first; }; for (arguments[0] in { name: 1 }); return both(read, first); }
function elementOfForOf(first) { var read = function () { return first; }; for (arguments[0] of ["of"]); return both(read, first); }
function elementDeleted(first) { var read = function () { return first; }; delete arguments[0]; arguments[0] = "untied"; return both(read, first); }
function parameterStored(first) { var read = function () { return arguments.length + first; }; first = "parameter"; return both(read, arguments[0]); }
function parameterStoredInClosure(first) { var store = function () { first = "in a closure"; }; store(); return arguments[0] + " " + first; }
function parameterStoredInArrow(first) { var store = () => { first = "in an arrow"; }; store(); return arguments[0] + " " + first; }
function parameterCounted(first) { var read = function () { return first; }; first++; return both(read, arguments[0]); }
function parameterOfPattern(first) { var read = function () { return first; }; [first] = ["own pattern"]; return both(read, arguments[0]); }
function secondStored(first, second) { var read = function () { return first + second; }; second = "second"; return both(read, arguments[0] + arguments[1]); }
function storedInArrow(first) { var read = function () { return first; }; (() => { arguments[0] = "arrow"; })(); return both(read, first); }
function handedOver(first) { var read = function () { return first; }; storeInto(arguments, "handed over"); return both(read, first); }
function handedOverInList(first) { var read = function () { return first; }; var list = [arguments]; storeInto(list[0], "in a list"); return both(read, first); }
function handedOverByName(first) { var read = function () { return first; }; var same = arguments; same[0] = "second name"; return both(read, first); }
function handedOverByApply(first) { var read = function () { return first; }; storeInto.apply(null, [arguments, "applied"]); return both(read, first); }
function elementCalled(first, callee) { var read = function () { return first; }; arguments[1](); return both(read, first); }
function elementCalledInBrackets(first, callee) { var read = function () { return first; }; (arguments[1])(); return both(read, first); }
function elementCalledIfThere(first, callee) { var read = function () { return first; }; arguments[1]?.(); return both(read, first); }
function elementOfChainCalled(first, callee) { var read = function () { return first; }; arguments?.[1](); return both(read, first); }
function elementAsTag(first, callee) { var read = function () { return first; }; arguments[1]``; return both(read, first); }
function memberCalled(first) { var read = function () { return first; }; arguments.hasOwnProperty.constructor; arguments.store = storesIntoThis; arguments.store(); return both(read, first); }
function evaluated(first) { var read = function () { return first; }; eval("arguments[0] = 'evaluated'"); return both(read, first); }
function evaluatedParameter(first) { var read = function () { return first; }; eval("first = 'evaluated parameter'"); return both(read, arguments[0]); }
function evaluatedInArrow(first) { var read = function () { return first; }; (() => eval("arguments[0] = 'evaluated in an arrow'"))(); return both(read, first); }
function withObject(first) { var read = function () { return first; }; with (arguments) { length = 0; } return both(read, arguments.length); }
function ownVariable(first) { var read = function () { return first; }; var arguments; arguments[0] = "own variable"; return both(read, first); }
function ownVariableStored(first) { var read = function () { return first; }; var arguments = [first + "?"]; return both(read, arguments[0]); }
function defined(first) { var read = function () { return first; }; Object.defineProperty(arguments, "0", { value: "defined" }); return both(read, first); }
function madeReadOnly(first) { var read = function () { return first; }; Object.defineProperty(arguments, "0", { writable: false }); first = "behind"; return both(read, arguments[0]); }
function pushedInto(first) { var read = function () { return first; }; Array.prototype.fill.call(arguments, "filled"); return both(read, first); }
function spread(first) { var read = function () { return first; }; return both(read, [...arguments].join()); }
function lengthStored(first) { var read = function () { return first; }; arguments.length = 0; return both(read, arguments.length + " " + arguments[0]); }
function onlyRead(first, second) { var read = function () { return first + second; }; return both(read, arguments[0] + arguments[1] + arguments[2] + arguments.length + typeof arguments.callee + arguments["length"]); }
function* generator(first) { var read = function () { return first; }; yield arguments.length; arguments[0] = "generator"; yield both(read, first); }
var object = {
  method(first) { var read = function () { return first; }; arguments[0] = "method"; return both(read, first); },
  onlyReads(first) { var read = function () { return first; }; return both(read, arguments[0] + arguments.length); },
  get got() { return (function (first) { var read = () => first; arguments[0] = "getter"; return both(read, first); })("g"); },
};
class Sloppy { static make(first) { var read = function () { return first; }; arguments[0] = "strict by class"; return both(read, first); } }

say("elementStored", elementStored("a"));
say("elementStoredByKey", elementStoredByKey("a", 0));
say("elementStoredByKey of a text", elementStoredByKey("a", "0"));
say("elementStoredByKey past the end", elementStoredByKey("a", 5));
say("elementCounted", elementCounted(1));
say("elementAddedTo", elementAddedTo("a"));
say("elementOfPattern", elementOfPattern("a"));
say("elementOfObjectPattern", elementOfObjectPattern("a"));
say("elementOfRest", elementOfRest("a"));
say("elementOfForIn", elementOfForIn("a"));
say("elementOfForOf", elementOfForOf("a"));
say("elementDeleted", elementDeleted("a"));
say("parameterStored", parameterStored("a"));
say("parameterStoredInClosure", parameterStoredInClosure("a"));
say("parameterStoredInArrow", parameterStoredInArrow("a"));
say("parameterCounted", parameterCounted(1));
say("parameterOfPattern", parameterOfPattern("a"));
say("secondStored", secondStored("a", "b"));
say("secondStored, not passed", secondStored("a"));
say("storedInArrow", storedInArrow("a"));
say("handedOver", handedOver("a"));
say("handedOverInList", handedOverInList("a"));
say("handedOverByName", handedOverByName("a"));
say("handedOverByApply", handedOverByApply("a"));
say("elementCalled", elementCalled("a", storesIntoThis));
say("elementCalledInBrackets", elementCalledInBrackets("a", storesIntoThis));
say("elementCalledIfThere", elementCalledIfThere("a", storesIntoThis));
say("elementOfChainCalled", elementOfChainCalled("a", storesIntoThis));
say("elementAsTag", elementAsTag("a", tag));
say("memberCalled", memberCalled("a"));
say("evaluated", evaluated("a"));
say("evaluatedParameter", evaluatedParameter("a"));
say("evaluatedInArrow", evaluatedInArrow("a"));
say("withObject", withObject("a"));
say("ownVariable", ownVariable("a"));
say("ownVariableStored", ownVariableStored("a"));
say("defined", defined("a"));
say("madeReadOnly", madeReadOnly("a"));
say("pushedInto", pushedInto("a"));
say("spread", spread("a", "b"));
say("lengthStored", lengthStored("a"));
say("onlyRead", onlyRead("a", "b"));
say("onlyRead, one passed", onlyRead("a"));
say("onlyRead, three passed", onlyRead("a", "b", "c"));
say("generator", [...generator("a")].join());
say("method", object.method("a"));
say("onlyReads", object.onlyReads("a"));
say("getter", object.got);
say("class", Sloppy.make("a"));
console.log(lines.join("\n"));
