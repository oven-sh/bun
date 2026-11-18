// answers: with-library
// # The prototype object of a class has a `constructor` of its own: the class object. No record lists it. It hides whatever a class above declares under that name by a computed key:
// # `set ["constructor"](v) {}`, a getter, a method. A lookup through the row of classes went past it: `new Below().constructor === Below` was false, and `below.constructor = 5` called the setter of the class above.
// # LinkFlow::membersFoundUnder() and LinkTables::findMember() end at the first class that does not declare the name itself.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
class OnlySetter { set ["constructor"](value) { report("the setter is called"); } }
class Below extends OnlySetter {}
class OnlyGetter { get ["constructor"]() { return 7; } }
class BelowGetter extends OnlyGetter {}
class Method { ["constructor"]() { return 8; } }
class BelowMethod extends Method {}
class FarBelow extends BelowMethod {}
report(new Below().constructor === Below, new OnlySetter().constructor);
report(new BelowGetter().constructor === BelowGetter, new OnlyGetter().constructor);
report(new BelowMethod().constructor === BelowMethod, new FarBelow().constructor === FarBelow, new Method().constructor());
const stored = new Below();
stored.constructor = 5;
report(stored.constructor, Object.hasOwn(stored, "constructor"));
const swallowed = new OnlySetter();
swallowed.constructor = 5;
report(swallowed.constructor, Object.hasOwn(swallowed, "constructor"));
function read(value) { return value.constructor; }
report(read(new Below()) === Below, read(new OnlySetter()), read(new BelowGetter()) === BelowGetter, read(new OnlyGetter()));
report("end");
