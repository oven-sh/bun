function show(value) { return typeof value == "function" ? "function " + value.name : typeof value == "symbol" ? "symbol" : value === undefined ? "undefined" : value; }
function withRest(func, start) {
  return function () {
    var args = arguments, index = -1, length = Math.max(args.length - start, 0), rest = Array(length);
    while (++index < length) rest[index] = args[start + index];
    index = -1;
    var others = Array(start + 1);
    while (++index < start) others[index] = args[index];
    others[start] = rest;
    return func.apply(this, others);
  };
}
exports.restFromOne = withRest(function (first, rest) { return [show(first), rest.map(show)]; }, 1);
exports.restFromZero = withRest(function (rest) { return rest.map(show); }, 0);
exports.restFromText = withRest(function () { return Array.prototype.map.call(arguments, show); }, "1");
exports.restFromCall = withRest(function () { return Array.prototype.map.call(arguments, show); }, "call");
exports.byTheFirstArgument = function named(key) { var args = arguments; return [show(args[key]), args.length]; };
exports.byTheFirstArgumentDirectly = function direct(key) { return [show(arguments[key]), arguments.length]; };
exports.calleeByAKey = function itself(key) { var args = arguments; return [args[key] === itself, args["cal" + "lee"] === itself, args[String(key)] === itself]; };
exports.anonymous = function (key) { var args = arguments; var found = args[key]; return [typeof found, found === exports.anonymous]; };
exports.bySymbol = function () { var args = arguments; return [show(args[Symbol.iterator]), show(args[Symbol.toStringTag])]; };
exports.keyIsConvertedOnce = function (a) { var args = arguments, log = []; var key = { toString: function () { log.push("toString"); return "0"; } }; return [show(args[key]), log]; };
exports.keyThatThrows = function (a) { var args = arguments; return args[{ toString: function () { throw new RangeError("key"); } }]; };
exports.inATry = function (key) { var args = arguments; try { return [show(args[key]), show(args[{ toString: function () { throw new RangeError("key"); } }])]; } catch (error) { return [error.name, args.length]; } };
exports.parametersAreRead = function (a, b) { var args = arguments; return [show(a), show(b), show(args[a]), show(args[b]), args.length]; };
exports.moreParametersThanArguments = function (a, b, c) { var args = arguments; return [show(args[a]), show(args["2"]), show(args[2]), show(c), args.length]; };
exports.passedOn = function (key) { var args = arguments; return [exports.byTheFirstArgument.apply(null, args), show(args[key])]; };
exports.readBeforeItIsBound = function (key) { var early = typeof args; var args = arguments; return [early, show(args[key])]; };
exports.inALoop = function (key) { var args = arguments, found = []; for (var i = 0; i < 3; i++) found.push(show(args[i == 1 ? key : i])); return found; };
exports.storedToTells = function (a, key) { var args = arguments; a = "stored"; return [show(args[0]), show(args[key])]; };
exports.writtenThroughTells = function (a, key) { var args = arguments; args[0] = "written"; return [show(a), show(args[key])]; };
exports.calledThroughTells = function (f) { var args = arguments; return typeof f == "function" ? args[0]() : show(args[f]); };
exports.handedOutTells = function (key) { var args = arguments; return [show(args[key]), Object.prototype.toString.call(args)]; };
exports.reboundTells = function (key) { var args = arguments; var first = show(args[key]); args = [7, 8, 9]; return [first, show(args[key])]; };
exports.seenByAnInnerFunctionTells = function (key) { var args = arguments; return [function () { return show(args[key]); }(), (() => show(arguments[key]))()]; };
function declared(key) { var args = arguments; return [show(args[key]), args[key] === declared, args.length]; }
exports.declared = declared;
function declaredAndCalledByName(key) { var args = arguments; return key === "again" ? "done" : [show(args[key]), declaredAndCalledByName("again")]; }
exports.declaredAndCalledByName = declaredAndCalledByName;
exports.nested = function (key) { function inner(k) { var args = arguments; return [show(args[k]), args[k] === inner]; } return [inner(key), inner("callee"), inner(0)]; };
function reassigned(key) { var args = arguments; return [show(args[key]), typeof args[key]]; }
exports.reassigned = reassigned;
reassigned = null;
