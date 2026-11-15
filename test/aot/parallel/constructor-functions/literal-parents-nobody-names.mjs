// A literal names its parent by __proto__, and another statement names another: what is found above the objects made before is as written.
function blocks() {
  function Base(v) { this.v = v; }
  Base.prototype = { ask() { return this.v * 4; }, get deep() { return () => this.v * 5; }, set w(value) { this.v = value; } };
  function Second(v) { this.v = v; }
  Second.prototype = { ask() { return 'second' + this.v; }, get deep() { return () => 'deep' + this.v; } };
  const call = list => { const out = []; for (const each of list) { try { out.push(each.ask(), each.deep()); } catch (error) { out.push(error.name); } } return out.join(); };
  const row = (first, then) => {
    function Child(v) { this.v = v; }
    first(Child, Base, Second);
    const one = new Child(1);
    const before = call([one, new Child(2)]);
    const mapped = [1, 2, 3].map(v => new Child(v)).map(each => each.ask()).join();
    try { then(Child, Base, Second); } catch (error) { console.log(error.name); }
    console.log(before, mapped, call([one, new Child(2)]), [1, 2, 3].map(v => new Child(v)).map(each => each.ask ? each.ask() : 'none').join());
  };
  row((C, B) => { C.prototype = { __proto__: B.prototype, constructor: C }; }, C => { C.prototype = { ask: () => 77 }; });
  row((C, B) => { C.prototype = { __proto__: B.prototype }; }, (C, B, S) => { C.prototype = { __proto__: S.prototype, other: 1 }; });
  row((C, B) => { C.prototype = { __proto__: B.prototype }; }, (C, B, S) => { Object.setPrototypeOf(C.prototype, S.prototype); });
  row((C, B) => { C.prototype = Object.create(B.prototype); }, C => { C.prototype = { deep: () => 5 }; });
}
blocks();
function Base(v) { this.v = v; }
Base.prototype = { ask() { return this.v * 4; } };
function Second(v) { this.v = v; }
Second.prototype = Object.create(Base.prototype);
Second.prototype.ask = function () { return 'second' + this.v; };
function call(list) { const out = []; for (const each of list) { try { out.push(each.ask()); } catch (error) { out.push(error.name); } } return out.join(); }
function First(v) { this.v = v; }
First.prototype = { __proto__: Base.prototype, constructor: First };
const ofFirst = new First(1);
console.log(call([ofFirst, new First(2)]));
First.prototype = { ask: () => 77 };
console.log(call([ofFirst, new First(2)]));
function Twice(v) { this.v = v; }
Twice.prototype = { __proto__: Base.prototype, constructor: Twice };
const ofTwice = new Twice(1);
console.log(call([ofTwice, new Twice(2)]));
Twice.prototype = { __proto__: Second.prototype, other: 1 };
console.log(call([ofTwice, new Twice(2)]), ofTwice.other, new Twice(3).other);
function Chosen(v) { this.v = v; }
Chosen.prototype = { __proto__: process.argv.length > 100 ? Second.prototype : Base.prototype };
console.log(call([new Chosen(1), new Chosen(2)]));
function Handed(v) { this.v = v; }
function lay(parent) { Handed.prototype = { __proto__: parent, constructor: Handed }; }
lay(Base.prototype);
const ofHanded = new Handed(1);
console.log(call([ofHanded, new Handed(2)]));
lay(Second.prototype);
console.log(call([ofHanded, new Handed(2)]));
class Other { ask() { return 'other'; } }
function Heir(v) { this.v = v; }
const pick = [Other][0];
Heir.prototype = { __proto__: pick.prototype };
console.log(call([new Heir(1)]));
Other.prototype.ask = function () { return 'changed'; };
console.log(call([new Heir(1), new Other()]));
