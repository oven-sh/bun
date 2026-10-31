// `Error.call(this, message)`, `x instanceof Error`: a built-in constructor is called like every built-in function. It takes no `call`, `apply`, `bind` or Symbol.hasInstance of its own and no other prototype,
// also where the constructor goes through native code, so that the compiler does not see what the change is made to. Every other name may be added, and a class below such a constructor is the program's own.
function handedThroughNativeCode(value) {
  let out;
  const target = new EventTarget();
  target.addEventListener("x", event => {
    out = event.detail;
  });
  target.dispatchEvent(new CustomEvent("x", { detail: value }));
  return out;
}
function planted() {
  return "planted ran";
}
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
const above = Object.create(Function.prototype);
above.call = planted;
for (const [name, constructor, run] of [
  ["Error", Error, () => typeof Error.call(null, "m")],
  ["RangeError", RangeError, () => typeof RangeError.call(null, "m")],
  ["AggregateError", AggregateError, () => typeof AggregateError.call(null, [])],
  ["Function", Function, () => typeof Function.call],
  ["WeakRef", WeakRef, () => typeof WeakRef.call(null, {})],
  ["FinalizationRegistry", FinalizationRegistry, () => typeof FinalizationRegistry.call(null, planted)],
  ["DataView", DataView, () => typeof DataView.call(null, new ArrayBuffer(1))],
  ["Intl.Collator", Intl.Collator, () => typeof Intl.Collator.call(null)],
  ["Iterator", Iterator, () => typeof Iterator.call(null)],
  ["DisposableStack", DisposableStack, () => typeof DisposableStack.call(null)],
]) {
  const unseen = handedThroughNativeCode(constructor);
  const ways = [
    attempt(() => ((unseen.call = planted), "stored")),
    attempt(() => Reflect.set(unseen, "apply", planted)),
    attempt(() => (Object.defineProperty(unseen, "bind", { value: planted }), "defined")),
    attempt(() => Reflect.defineProperty(unseen, Symbol.hasInstance, { value: () => true })),
    attempt(() => Reflect.setPrototypeOf(unseen, above)),
    attempt(() => (Object.setPrototypeOf(unseen, above), "changed")),
    attempt(() => Reflect.setPrototypeOf(unseen, Object.getPrototypeOf(constructor))),
  ];
  const answer = attempt(run);
  unseen.added = 1;
  console.log(name, "|", ways.join(", "), "|", answer, "|", 1 instanceof constructor, Object.hasOwn(constructor, "call"), constructor.added, delete constructor.added);
}

Error.stackTraceLimit = 7;
console.log(Error.stackTraceLimit);

class Below extends Error {}
Below.call = planted;
Below.count = 2;
Object.defineProperty(Below, Symbol.hasInstance, { value: () => true });
console.log(Below.call(null), Below.count, 1 instanceof Below, new Below("m") instanceof Error, Object.getPrototypeOf(Below) === Error);
Object.setPrototypeOf(Below, RangeError);
console.log(Object.getPrototypeOf(Below) === RangeError);

function plain() {}
plain.call = planted;
plain.displayName = "a name";
console.log(plain.call(), plain.displayName);
/* Output:
Error | TypeError, false, TypeError, false, false, TypeError, true | object | false false 1 true
RangeError | TypeError, false, TypeError, false, false, TypeError, true | object | false false 1 true
AggregateError | TypeError, false, TypeError, false, false, TypeError, true | object | false false 1 true
Function | TypeError, false, TypeError, false, false, TypeError, true | function | false false 1 true
WeakRef | TypeError, false, TypeError, false, false, TypeError, true | TypeError | false false 1 true
FinalizationRegistry | TypeError, false, TypeError, false, false, TypeError, true | TypeError | false false 1 true
DataView | TypeError, false, TypeError, false, false, TypeError, true | TypeError | false false 1 true
Intl.Collator | TypeError, false, TypeError, false, false, TypeError, true | object | false false 1 true
Iterator | TypeError, false, TypeError, false, false, TypeError, true | TypeError | false false 1 true
DisposableStack | TypeError, false, TypeError, false, false, TypeError, true | TypeError | false false 1 true
7
planted ran 2 true true true
true
planted ran a name
*/
