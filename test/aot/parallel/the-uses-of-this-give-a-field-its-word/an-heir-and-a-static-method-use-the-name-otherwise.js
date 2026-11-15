// A class in a file without types: a constructor's parameter fills the field, so nothing is written of it; what the class's own methods do with `this.<name>` gives the field a word, as a parameter's uses give the parameter one. The word is expected alone: every read is guarded at the run. The data comes out of a text. An heir uses the name as a number's holder, and a static method reads the same name off the class itself: neither speaks for the field of the class above.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } static sum() { return this.items * 2; } }
Box.items = 21;
class Heir extends Box { constructor(items) { super(items); } half() { return this.items / 2; } }
const name = text => JSON.parse(text);
const out = text => JSON.parse(text);
console.log(new Box(out('[0.5,1.5]'))[name('"sum"')](), Box[name('"sum"')](), new Heir(10)[name('"half"')](), new Heir(out('[1,2]'))[name('"sum"')](), new Box(new Uint8Array([7, 8]))[name('"sum"')]());
