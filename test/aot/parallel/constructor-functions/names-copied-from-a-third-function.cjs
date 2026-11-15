// A helper links a constructor function below another one and copies the names of a third function onto it.
const out = [];
const hasProp = {}.hasOwnProperty;
function mix(child, parent, extra) { for (const key in extra) if (hasProp.call(extra, key)) child[key] = extra[key]; function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; }
{
  // Nothing else calls what is copied.
  function Extra(x) { this.x = x; }
  Extra.make = function (x) { return 'extra ' + x; };
  Extra.prototype.go = function () { return this.x; };
  function Base(x) { this.b = x; }
  Base.prototype.go = function () { return this.b; };
  Base.twice = function (x) { return 'base ' + x; };
  function Child(x) { this.b = x; this.c = x; }
  mix(Child, Base, Extra);
  const all = [new Child(1), new Extra(3), new Base(5)];
  for (let i = 0; i < 3; i++) {
    let twice; try { twice = Child.twice(i); } catch (error) { twice = error.name; }
    out.push(Child.make(i), twice, all.map(one => one.go()).join(), Object.keys(Child).join());
  }
}
{
  // The child has one of its own under the name, which the copy replaces.
  function Extra2(x) { this.x = x; }
  Extra2.make = function (x) { return 'extra2 ' + x; };
  Extra2.prototype.go = function () { return this.x; };
  function Base2(x) { this.b = x; }
  Base2.prototype.go = function () { return this.b; };
  Base2.make = function (x) { return 'base2 ' + x; };
  function Child2(x) { this.b = x; this.c = x; }
  Child2.make = function (x) { return 'child2 ' + x; };
  mix(Child2, Base2, Extra2);
  const all = [new Child2(1), new Extra2(3), new Base2(5)];
  for (let i = 0; i < 3; i++) out.push(Child2.make(i), Base2.make(i), all.map(one => one.go()).join());
}
{
  // What is copied is called with numbers elsewhere.
  function Extra3(x) { this.x = x; }
  Extra3.make = function (x) { let s = 0; for (let i = 0; i < 3; i++) s = x + s; return s; };
  Extra3.prototype.go = function () { return this.x; };
  function Base3(x) { this.b = x; }
  Base3.prototype.go = function () { return this.b; };
  function Child3(x) { this.b = x; }
  mix(Child3, Base3, Extra3);
  const all = [new Child3(1), new Extra3(3), new Base3(5)];
  out.push(all.map(one => one.go()).join(), Extra3.make(2), Extra3.make(3), Child3.make('a'), Child3.make(0.5), Child3.make(undefined));
  const read = Child3.make;
  out.push(read('b'));
}
console.log(out.map(String).join('\n'));
