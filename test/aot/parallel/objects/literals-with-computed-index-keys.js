function show(name, object) {
  console.log(name, Object.keys(object).join(","), JSON.stringify(object));
}
function make(a, b, c, value) {
  return { first: 1, [a]: value, second: 2, [b]: value + 1, [c]: value + 2, third: 3 };
}
show("small", make(0, 1, 2, 10));
show("backwards", make(2, 1, 0, 10));
show("same", make(5, 5, 5, 10));
show("far", make(1000000, 3, 4000000000, 10));
show("not indexes", make(-1, 1.5, 4294967295, 10));
show("texts of indexes", make("0", "1", "07", 10));
show("minus zero", make(-0, 0, "-0", 10));
show("mixed", make("name", 3, Symbol.iterator, 10));
for (let round = 0; round < 4; round++) show("round " + round, make(round, round * 2, round * 1000, round));

function withAccessor(key) {
  return { get 0() { return "got"; }, [key]: "defined", set 1(value) {}, [key + 1]: "also" };
}
show("over accessors", withAccessor(0));
console.log(Object.getOwnPropertyDescriptor(withAccessor(0), "0").value, Object.getOwnPropertyDescriptor(withAccessor(0), "1").value, typeof Object.getOwnPropertyDescriptor(withAccessor(5), "0").get);

function asPrototype(key) {
  const base = { name: "base", [key]: "inherited" };
  const heir = Object.create(base);
  return [heir[key], Object.keys(heir).length, key in heir].join(" ");
}
console.log(asPrototype(0), asPrototype(7), asPrototype(123456789));

class Fields {
  [0] = "zero";
  [1] = "one";
  name = "fields";
  [1000000] = "far";
}
show("class fields", new Fields());
class Below extends Fields {
  [0] = "again";
  [2] = "two";
}
show("class fields below", new Below());

function spread(source, key) {
  return { ...source, [key]: "last", tail: true };
}
show("spread", spread({ 0: "a", 1: "b", x: 1 }, 1));
show("spread of an array", spread(["a", "b", "c"], 5));

const many = {};
const built = { start: 0 };
for (let index = 0; index < 300; index++) Object.assign(many, { [index * 7 % 300]: index });
show("many", many);
const wide = { a: 1, [0]: 0, [1]: 1, [2]: 2, [3]: 3, [4]: 4, [5]: 5, [6]: 6, [7]: 7, [8]: 8, [9]: 9, [10]: 10, [11]: 11, [12]: 12, z: 26 };
show("wide", wide);
wide[13] = 13;
delete wide[5];
Object.defineProperty(wide, 6, { value: "fixed", writable: false, enumerable: true, configurable: false });
show("wide, changed", wide);
console.log(Object.isFrozen(Object.freeze({ a: 1, [0]: 0 })), built.start);
