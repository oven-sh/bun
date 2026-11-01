// Objects are printed whose prototypes hold symbols between names.
const local = Symbol("local");
const show = (label, value) => console.log(label, Bun.inspect(value).replace(/\s+/g, " "));

const base = { [local]: 1, name: 2 };
show("a literal above an empty literal", { __proto__: base });
show("a literal above a literal with a property", { __proto__: base, own: 0 });
show("made by Object.create", Object.create(base));

const grown = {};
grown.first = 1;
grown[local] = 2;
grown.last = 3;
show("a prototype filled key by key", Object.create(grown));

const top = { [Symbol.for("top")]: 1, t: 2 };
const middle = { __proto__: top, m: 3, [Symbol.for("middle")]: 4 };
show("two levels", { __proto__: middle, own: 5 });
show("two levels above nothing", { __proto__: middle });

const shadowing = { __proto__: base, name: "own" };
show("an own name hides an inherited one", shadowing);
const shadowingSymbol = { __proto__: base, [local]: "own" };
show("an own symbol hides an inherited one", shadowingSymbol);

class Holder {
  [local] = 1;
  field = 2;
  [Symbol.for("method")]() {}
  method() {}
}
show("an instance", new Holder());
show("an object below an instance", Object.create(new Holder()));
show("an object below a class prototype", Object.create(Holder.prototype));

const hidden = {};
Object.defineProperty(hidden, local, { value: 1, enumerable: false, configurable: true, writable: true });
hidden.seen = 2;
Object.defineProperty(hidden, "unseen", { value: 3, enumerable: false, configurable: true, writable: true });
hidden[Symbol.for("seen")] = 4;
show("properties that are not enumerable", hidden);
show("below properties that are not enumerable", Object.create(hidden));

const withGetter = {
  [local]: 1,
  get computed() {
    return 2;
  },
  plain: 3,
};
show("below a getter", Object.create(withGetter));

const withElements = { [local]: 1, 0: "zero", plain: 3 };
show("below elements", Object.create(withElements));

const changed = { [local]: 1, a: 2, b: 3 };
delete changed.a;
changed.a = 4;
show("below a removed and added name", Object.create(changed));
console.log(Object.create(base));
console.log([Object.create(base)], new Map([[Object.create(base), Object.create(grown)]]));
const late = { [Symbol.asyncDispose]() {} };
const below = { __proto__: late };
for (let i = 0; i < 3; i++) late["p" + i] = i;
console.log(below);
console.log(late);
