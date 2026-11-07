// Two records of one literal, one of which gets a getter under "constructor" that is not enumerable. node:util's isDeepStrictEqual holds the constructor that the first of the two inherits against what the second answers under that name, and takes the prototype of a first that owns the name: in whichever order the two come.
// Alone: whether the layout keeps the getter in a slot of the record goes by every creation of "constructor" in the executable
const { isDeepStrictEqual } = require("node:util");

function Other() {}
const make = () => ({ a: 1 });
const withGetter = () => Object.defineProperty(make(), "constructor", { get() { return Other; }, enumerable: false, configurable: true });
const tell = (label, first, second) => console.log(label + ":", isDeepStrictEqual(first, second));

tell("the record with the getter is the second", make(), withGetter());
tell("the record with the getter is the first", withGetter(), make());
tell("in lists, the second", [make()], [withGetter()]);
tell("in lists, the first", [withGetter()], [make()]);
tell("neither has the getter", make(), make());
tell("both have the getter", withGetter(), withGetter());
