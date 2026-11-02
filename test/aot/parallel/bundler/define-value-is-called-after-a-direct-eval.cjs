// A call through a `--define` value looks the first name up where the call is written. After a direct `eval` whose text declares the name, what the text declared is called: one name without a receiver, and a member with its object.
// Flags: --define CALL=target --define MAKE=holder.make
globalThis.target = function () {
  return "the global, called on " + (this === globalThis ? "the global object" : typeof this);
};
globalThis.holder = {
  name: "the global holder",
  make() {
    return "a member of " + this.name;
  },
};
function call(text) {
  eval(text);
  return CALL() + " | " + MAKE();
}
console.log(call(""));
console.log(
  call(
    "var target = function () { 'use strict'; return 'what the text declared, called on ' + typeof this; }, holder = { name: 'the declared holder', make() { return 'a member of ' + this.name; } }",
  ),
);
