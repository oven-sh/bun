// In the manner of the package symbol-observable: where Symbol.observable is missing it makes a symbol and assigns it to Symbol, and every library that loads afterwards finds the same one.
function ponyfill(root) {
  let result;
  const { Symbol } = root;
  if (typeof Symbol === "function") {
    if (Symbol.observable) result = Symbol.observable;
    else {
      result = Symbol("observable");
      Symbol.observable = result;
    }
  } else result = "@@observable";
  return result;
}

const first = ponyfill(globalThis);
const second = ponyfill(globalThis);
const store = { [first]() { return this; }, subscribe() { return "subscribed"; } };
console.log([typeof first, first === second, first === Symbol.observable, String(first), store[Symbol.observable]().subscribe(), Object.keys(Symbol).join(), Symbol.observable in store].join(" "));
console.log([typeof Symbol.iterator, [][Symbol.iterator] === [].values, Symbol("a").description, Symbol.for("b") === Symbol.for("b")].join(" "));
