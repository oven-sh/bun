// Headers and URLSearchParams are iterated in every way the language has, also while they change, and an object with an iterator method, a next or a return of its own still runs that. A compiled program locks the members of the two iterator prototypes as it locks those of the language's own iterators: they take no index-like key, no well-known symbol, no then, no toJSON, no name of an object further up, no next, no return and no throw, their prototypes stay, and they take other names as before.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

function say(label, run) {
  let text;
  try {
    text = JSON.stringify(run());
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  console.log(label + ": " + text);
}
const describeStep = step => (step.done ? "done " + step.value : String(step.value));
const stepsOf = (iterator, count) => Array.from({ length: count }, () => describeStep(iterator.next()));

const newHeaders = () => new Headers([["b", "2"], ["a", "1"], ["Content-Type", "text/plain"]]);
say("headers: for..of", () => { const seen = []; for (const [name, value] of newHeaders()) seen.push(name + "=" + value); return seen; });
say("headers: for..of without a pattern", () => { const seen = []; for (const pair of newHeaders()) seen.push(pair.length, Array.isArray(pair)); return seen; });
say("headers: spread", () => [...newHeaders()]);
say("headers: entries", () => [...newHeaders().entries()]);
say("headers: keys", () => { const seen = []; for (const name of newHeaders().keys()) seen.push(name.toUpperCase()); return seen; });
say("headers: values", () => { const seen = []; for (const value of newHeaders().values()) seen.push(value.length); return seen; });
say("headers: Object.fromEntries", () => Object.fromEntries(newHeaders()));
say("headers: new Map", () => { const map = new Map(newHeaders()); return [map.size, map.get("content-type"), [...map.keys()]]; });
say("headers: Array.from", () => Array.from(newHeaders().keys(), name => name.length));
say("headers: a pattern", () => { const [[first], , [, third]] = newHeaders(); return [first, third]; });
say("headers: iterator helpers", () => newHeaders().keys().filter(name => name.length === 1).map(name => name + "!").toArray());
say("headers: next by hand", () => stepsOf(newHeaders().entries(), 5));
say("headers: appended to while they are walked", () => { const headers = new Headers({ b: "2", d: "4" }); const seen = []; for (const [name] of headers) { seen.push(name); if (name === "b") headers.append("c", "3"); } return seen; });
say("headers: deleted from while they are walked", () => { const headers = new Headers({ b: "2", c: "3", d: "4" }); const seen = []; for (const [name] of headers) { seen.push(name); headers.delete("c"); } return seen; });
say("headers: a value set while they are walked", () => { const headers = new Headers({ a: "1", b: "2" }); const seen = []; for (const [name, value] of headers) { seen.push(name + "=" + value); headers.set("b", "changed"); } return seen; });
say("headers: an iterator that has ended stays ended", () => { const headers = new Headers({ a: "1" }); const names = headers.keys(); const steps = stepsOf(names, 2); headers.append("b", "2"); return [...steps, ...stepsOf(names, 1), [...headers.keys()]]; });
say("headers: one iterator in two loops", () => { const names = newHeaders().keys(); const seen = []; for (const name of names) { seen.push(name); break; } for (const name of names) seen.push(name); return seen; });
say("headers: what an iterator is", () => {
  const headers = newHeaders();
  const names = headers.keys();
  const prototype = Object.getPrototypeOf(names);
  return [names[Symbol.iterator]() === names, names instanceof Iterator, Object.getPrototypeOf(prototype) === Iterator.prototype, prototype === Object.getPrototypeOf(headers.entries()), prototype === Object.getPrototypeOf(headers.values()), prototype === Object.getPrototypeOf(headers[Symbol.iterator]()), Object.prototype.toString.call(names), Reflect.ownKeys(prototype).map(String).join(), Reflect.ownKeys(names).length, headers[Symbol.iterator] === headers.entries];
});

const newParameters = () => new URLSearchParams("b=2&a=1&b=3");
say("search parameters: for..of", () => { const seen = []; for (const [name, value] of newParameters()) seen.push(name + "=" + value); return seen; });
say("search parameters: for..of without a pattern", () => { const seen = []; for (const pair of newParameters()) seen.push(pair.length, Array.isArray(pair)); return seen; });
say("search parameters: spread", () => [...newParameters()]);
say("search parameters: entries", () => [...newParameters().entries()]);
say("search parameters: keys", () => { const seen = []; for (const name of newParameters().keys()) seen.push(name.toUpperCase()); return seen; });
say("search parameters: values", () => { const seen = []; for (const value of newParameters().values()) seen.push(value.length); return seen; });
say("search parameters: Object.fromEntries", () => Object.fromEntries(newParameters()));
say("search parameters: new Map", () => { const map = new Map(newParameters()); return [map.size, map.get("b"), [...map.keys()]]; });
say("search parameters: Array.from", () => Array.from(newParameters().values(), Number));
say("search parameters: a pattern", () => { const [[first], , [, third]] = newParameters(); return [first, third]; });
say("search parameters: iterator helpers", () => newParameters().values().filter(value => value !== "1").map(value => value + "!").toArray());
say("search parameters: next by hand", () => stepsOf(newParameters().entries(), 5));
say("search parameters: appended to while they are walked", () => { const parameters = new URLSearchParams("a=1"); const seen = []; for (const [name] of parameters) { seen.push(name); if (seen.length < 3) parameters.append(name + "x", "1"); } return seen; });
say("search parameters: deleted from while they are walked", () => { const parameters = new URLSearchParams("a=1&b=2&c=3"); const seen = []; for (const [name] of parameters) { seen.push(name); parameters.delete("b"); } return seen; });
say("search parameters: sorted while they are walked", () => { const parameters = new URLSearchParams("c=3&a=1&b=2"); const seen = []; for (const [name] of parameters) { seen.push(name); parameters.sort(); } return seen; });
say("search parameters: a value set while they are walked", () => { const parameters = new URLSearchParams("a=1&b=2"); const seen = []; for (const [name, value] of parameters) { seen.push(name + "=" + value); parameters.set("b", "changed"); } return seen; });
say("search parameters: an iterator that has ended stays ended", () => { const parameters = new URLSearchParams("a=1"); const names = parameters.keys(); const steps = stepsOf(names, 2); parameters.append("b", "2"); return [...steps, ...stepsOf(names, 1), [...parameters.keys()]]; });
say("search parameters: one iterator in two loops", () => { const names = newParameters().keys(); const seen = []; for (const name of names) { seen.push(name); break; } for (const name of names) seen.push(name); return seen; });
say("search parameters: what an iterator is", () => {
  const parameters = newParameters();
  const names = parameters.keys();
  const prototype = Object.getPrototypeOf(names);
  return [names[Symbol.iterator]() === names, names instanceof Iterator, Object.getPrototypeOf(prototype) === Iterator.prototype, prototype === Object.getPrototypeOf(parameters.entries()), prototype === Object.getPrototypeOf(parameters.values()), prototype === Object.getPrototypeOf(parameters[Symbol.iterator]()), Object.prototype.toString.call(names), Reflect.ownKeys(prototype).map(String).join(), Reflect.ownKeys(names).length, parameters[Symbol.iterator] === parameters.entries];
});

function namesOf(iterable) { const seen = []; for (const [name] of iterable) seen.push(name); return seen; }
say("one loop over headers, search parameters, a map, an array and strings", () => [namesOf(newHeaders()), namesOf(newParameters()), namesOf(new Map([["m", 1]])), namesOf([["x", 1]]), namesOf(["yz"])]);

const prototypeOfHeadersIterators = Object.getPrototypeOf(newHeaders().keys());
const prototypeOfParameterIterators = Object.getPrototypeOf(newParameters().keys());
const nextOfHeaders = prototypeOfHeadersIterators.next;
const nextOfParameters = prototypeOfParameterIterators.next;
say("the two classes have prototypes and functions of their own", () => [prototypeOfHeadersIterators === prototypeOfParameterIterators, nextOfHeaders === nextOfParameters, nextOfHeaders.name, nextOfHeaders.length]);
say("next of headers on another iterator of headers", () => describeStep(nextOfHeaders.call(newHeaders().values())));
say("next of search parameters on another iterator of search parameters", () => describeStep(nextOfParameters.call(newParameters().values())));
say("next of headers on an iterator of search parameters", () => nextOfHeaders.call(newParameters().keys()));
say("next of search parameters on an iterator of headers", () => nextOfParameters.call(newHeaders().keys()));
say("next of headers on the headers", () => nextOfHeaders.call(newHeaders()));
say("next of headers on its prototype", () => nextOfHeaders.call(prototypeOfHeadersIterators));
say("next of headers on an object that inherits from an iterator", () => nextOfHeaders.call(Object.create(newHeaders().keys())));
say("next of headers on an array iterator", () => nextOfHeaders.call([].values()));
say("next of headers on undefined", () => nextOfHeaders.call(undefined));
say("next of headers on a string", () => nextOfHeaders.call("text"));
say("next of a map iterator on an iterator of headers", () => new Map().keys().next.call(newHeaders().keys()));

say("headers with an iterator method of their own", () => { const headers = newHeaders(); headers[Symbol.iterator] = function* () { yield ["own", "method"]; }; return [[...headers], Object.fromEntries(headers), new Map(headers).get("own"), namesOf(headers), [...headers.entries()].length]; });
say("search parameters with an iterator method of their own", () => { const parameters = newParameters(); parameters[Symbol.iterator] = function* () { yield ["own", "method"]; }; return [[...parameters], Object.fromEntries(parameters), new Map(parameters).get("own"), namesOf(parameters), [...parameters.entries()].length]; });
say("a subclass of Headers with an iterator method", () => { class Reversed extends Headers { *[Symbol.iterator]() { yield* [...super.entries()].reverse(); } } return [...new Reversed({ a: "1", b: "2" })]; });
say("a subclass of URLSearchParams with an iterator method", () => { class Reversed extends URLSearchParams { *[Symbol.iterator]() { yield* [...super.entries()].reverse(); } } return [...new Reversed("a=1&b=2")]; });
say("an iterator of headers with a next of its own", () => { const names = newHeaders().keys(); let left = 2; names.next = () => ({ done: left-- === 0, value: "own" }); return [...names]; });
say("an iterator of search parameters with a next of its own", () => { const names = newParameters().keys(); let left = 2; names.next = () => ({ done: left-- === 0, value: "own" }); return [...names]; });
say("an iterator of headers with a return of its own", () => { const names = newHeaders().keys(); const calls = []; names.return = () => (calls.push("return"), {}); for (const name of names) { calls.push(name); break; } return calls; });
say("an iterator of search parameters with a return of its own", () => { const names = newParameters().keys(); const calls = []; names.return = () => (calls.push("return"), {}); for (const name of names) { calls.push(name); break; } return calls; });

const namesAboveAnIterator = ["map", "filter", "toArray", "hasOwnProperty", "toString"];
for (const [name, prototype] of [["iterators of Headers", prototypeOfHeadersIterators], ["iterators of URLSearchParams", prototypeOfParameterIterators]]) {
  tryToChange(name + ": a member", prototype, ["next", Symbol.toStringTag]);
  tryToChange(name + ": a key it is closed for", prototype, [...indexLikeKeys, ...wellKnownSymbols.filter(symbol => !Object.hasOwn(prototype, symbol)), "then", "toJSON", ...namesAboveAnIterator, "return", "throw"]);
  tryToChange(name + ": any other key", prototype, ["addedByTheProgram", Symbol("mine"), Symbol.for("shared")]);
  tryToChangePrototype(name, prototype);
}

prototypeOfHeadersIterators.count = function () { let count = 0; for (const item of this) count++; return count; };
say("what the program added", () => [newHeaders().keys().count(), typeof newParameters().keys().count]);
delete prototypeOfHeadersIterators.count;
say("and removed", () => typeof newHeaders().keys().count);
say("after all that", () => [namesOf(newHeaders()), namesOf(newParameters()), prototypeOfHeadersIterators.next === nextOfHeaders, prototypeOfParameterIterators.next === nextOfParameters]);
