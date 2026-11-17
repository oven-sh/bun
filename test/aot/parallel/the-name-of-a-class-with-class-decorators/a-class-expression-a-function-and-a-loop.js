const swap = (made) => class extends made {};
const seen = [];
const note = (value) => { seen.push(value); return () => {}; };
const kinds = () => seen.splice(0).map((value) => typeof value).join();

const made = @swap class Kit {
  @note(Kit) field = 1;
  static [(seen.push(Kit), "key")] = 2;
  static self = () => Kit;
};
console.log(kinds(), made.key, made.self() === made);

function make() {
  @swap class Kit {
    @note(Kit) field = 1;
    static self = () => Kit;
  }
  return Kit;
}
const first = make(), second = make();
console.log(kinds(), first !== second, first.self() === first, second.self() === second);

for (let turn = 0; turn < 2; turn++) {
  @swap class Kit {
    @note(Kit) field = 1;
  }
}
console.log(kinds());
