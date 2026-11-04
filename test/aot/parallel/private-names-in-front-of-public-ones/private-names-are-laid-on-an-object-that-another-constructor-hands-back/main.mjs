const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
class Hands {
  constructor(given) {
    return given;
  }
}
class Stamp extends Hands {
  #mark = 1;
  shown = 2;
  static read(object) {
    return object.#mark;
  }
}
const Made = unknown(Stamp);
const plain = { first: 0 };
new Made(plain);
const frozen = Object.freeze({ first: 0 });
console.log(Stamp.read(plain), Object.keys(plain).join(), tell(() => new Made(plain)), tell(() => new Made(frozen)), tell(() => Stamp.read(frozen)), Object.keys(frozen).join());
const list = [];
for (let i = 0; i < 300; i++) list.push(new Made({ first: i }));
console.log(list.reduce((sum, each) => sum + Stamp.read(each) + each.shown + each.first, 0));
