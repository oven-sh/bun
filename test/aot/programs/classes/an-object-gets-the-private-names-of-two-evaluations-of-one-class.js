// A function makes a class with private names and is called more than once. One object passes through two of the classes, so it holds the private names of both.
const lines = [];
let made = 0;
class Plain { plain = 1; }
function mix(Base) {
  const id = ++made;
  return class extends Base {
    #hidden = id;
    #method() { return "method " + id; }
    reads() { return this.#hidden; }
    calls() { return this.#method(); }
    below() { return typeof super.reads === "function" ? super.reads() + " " + super.calls() : "nothing"; }
    bump() { this.#hidden += 10; return this; }
    static has(object) { return #hidden in object; }
  };
}
const Once = mix(Plain), Twice = mix(Once), Thrice = mix(Twice);
for (const Class of [Once, Twice, Thrice]) {
  const object = new Class();
  lines.push(object.reads(), object.calls(), object.below(), object.bump().reads(), object.below(), Once.has(object), Twice.has(object), Thrice.has(object));
  lines.push(Object.keys(object).join(), JSON.stringify(object), Reflect.ownKeys(object).length, JSON.stringify({ ...object }), Thrice.has({ ...object }), "hidden" in object, object.hidden);
}
console.log(lines.join(" "));

lines.length = 0;
class Identity { constructor(object) { if (object) return object; } }
function stamper() {
  const id = ++made;
  return class Stamper extends Identity { #stamp = id; own = id; static has(object) { return #stamp in object; } static read(object) { return object.#stamp; } };
}
const First = stamper(), Second = stamper();
const stamped = new First();
lines.push(new Second(stamped) === stamped, First.read(stamped), Second.read(stamped), stamped.own, Object.keys(stamped).join(), JSON.stringify(stamped));
try { new Second(stamped); lines.push("twice"); } catch (error) { lines.push(error.constructor.name); }
try { new First(stamped); lines.push("twice"); } catch (error) { lines.push(error.constructor.name); }
lines.push(First.has(new Second()), Second.has(new First()));
console.log(lines.join(" "));

function local() { const object = new Twice(); return object.reads() * 100 + object.bump().reads() + object.plain; }
let sum = 0;
for (let turn = 0; turn < 20000; turn++) sum += local();
console.log(sum);
