// `v;` in a class defines the field with undefined on every object that its constructor is entered for, also on those of the classes below. There code of the class below stores to the name,
// so the field has a kind of its own: integers in one class, texts in another, objects in a third.
class Base {
  v;
  w;
  constructor(v) {
    this.v = v;
  }
  step(n) {}
}
class Ints extends Base {
  step(n) {
    this.v = (this.v * 79 + n) | 0;
  }
}
class Texts extends Base {
  step(n) {
    this.v = this.v + "!" + n;
  }
}
class Objects extends Base {
  step(n) {
    this.v = { inner: this.v, n };
  }
}
class Fractions extends Base {
  step(n) {
    this.v = this.v / 2 + n;
  }
}
class Untouched extends Base {}
class BelowInts extends Ints {
  step(n) {
    super.step(n);
    this.v = (this.v ^ 5) | 0;
  }
}
// The methods of these two are never called: what they store decides the kind all the same.
class NeverStepped extends Base {
  step(n) {
    this.v = (this.v * 79 + this.w) | 0;
  }
}
class NeverSteppedTexts extends Base {
  step(n) {
    this.v = this.v + "?";
  }
}
// Here the definition is seen: the constructor does not always store.
class Sometimes {
  v;
  constructor(v) {
    if (v > 1) this.v = v;
  }
}
class BelowSometimes extends Sometimes {
  step() {
    this.v = (this.v + 1) | 0;
  }
}
const show = object => object.constructor.name + " " + JSON.stringify(object) + " " + Object.keys(object).join() + " " + String(object.v) + " " + String(object.w);
const made = [new Ints(1), new Ints(2), new Texts("a"), new Texts("b"), new Objects(null), new Objects(3), new Fractions(1), new Fractions(0.5), new Untouched(1), new Untouched("u"), new BelowInts(7), new BelowInts(8), new Base(1), new Base("base")];
for (const object of made) console.log(show(object));
for (let round = 0; round < 3; round++) for (const object of made) object.step(round);
for (const object of made) console.log(show(object));
console.log(show(new NeverStepped(1)), show(new NeverStepped(2)), show(new NeverSteppedTexts("t")));
const sometimes = [new BelowSometimes(1), new BelowSometimes(2), new Sometimes(0), new Sometimes(5)];
for (const object of sometimes) console.log(show(object), "v" in object);
sometimes[0].step();
sometimes[1].step();
for (const object of sometimes) console.log(show(object));
