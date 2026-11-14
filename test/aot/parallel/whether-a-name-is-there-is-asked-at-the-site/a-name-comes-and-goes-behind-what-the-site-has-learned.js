function isIn(thing) { return "mark" in thing; }
function isOwn(thing) { return Object.prototype.hasOwnProperty.call(thing, "mark"); }
function hasOwn(thing) { return Object.hasOwn(thing, "mark"); }
function times(ask, thing) { let yes = 0; for (let turn = 0; turn < 400; turn++) if (ask(thing)) yes++; return yes; }
function all(label, thing) { console.log(label, times(isIn, thing), times(isOwn, thing), times(hasOwn, thing)); }

const plain = JSON.parse('{"left":1,"right":2}');
all("a parsed object without the name", plain);
plain.mark = 1;
all("the name is added", plain);
delete plain.mark;
all("the name is deleted", plain);
plain.mark = undefined;
all("the name is added again and holds undefined", plain);

const above = { other: 1 };
const below = Object.create(above);
all("nothing above", below);
above.mark = 1;
all("the name is laid above", below);
delete above.mark;
all("the name is taken from above", below);
Object.defineProperty(above, "mark", { get() { throw new Error("a getter ran"); }, configurable: true });
all("a getter above", below);
Object.defineProperty(below, "mark", { get() { throw new Error("a getter ran"); }, configurable: true });
all("a getter of its own", below);
delete below.mark;
delete above.mark;
all("both getters are gone", below);

const first = { mark: 1 };
const second = { other: 1 };
const moved = Object.create(second);
all("below an object without the name", moved);
Object.setPrototypeOf(moved, first);
all("laid below an object with the name", moved);
Object.setPrototypeOf(moved, null);
all("laid below nothing", moved);

const bare = Object.create(null);
all("an object below nothing", bare);
bare.mark = 0;
all("with the name", bare);

class Base { }
class Derived extends Base { }
all("an instance of a class", new Derived());
Base.prototype.mark = 1;
all("while the class above has the name", new Derived());
all("an object below nothing, meanwhile", Object.create(null));
delete Base.prototype.mark;
all("after the class above lost the name", new Derived());
