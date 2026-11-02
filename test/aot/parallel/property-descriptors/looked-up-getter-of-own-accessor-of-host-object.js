// `isTrusted` is an own accessor of every event. __lookupGetter__ searches the whole chain, which starts at the object itself.
const called = { getter: Object.prototype.__lookupGetter__.call(new Event("y"), "isTrusted") };
console.log(typeof called.getter);
const asMethod = { getter: new Event("y").__lookupGetter__("isTrusted") };
console.log(typeof asMethod.getter);
