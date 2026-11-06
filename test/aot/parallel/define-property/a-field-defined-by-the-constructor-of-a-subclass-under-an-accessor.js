// A class field is defined on the new object, past any accessor of that name above it, also when
// the only objects made are those of a subclass.
class Accessor {
  set x(v) {
    console.log("setter", v);
  }
  get x() {
    return "got";
  }
}
class Field extends Accessor {
  x = 0;
}
class OnlyMade extends Field {}
class Below extends OnlyMade {}

const made = new OnlyMade();
console.log(made.x, Object.keys(made));
const lower = new Below();
console.log(lower.x, Object.keys(lower));

const skipped = Reflect.construct(Accessor, [], OnlyMade);
skipped.x = 1;
console.log(skipped.x, Object.keys(skipped));
