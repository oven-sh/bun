const swap = (made) => class extends made {};
const keep = () => {};
const seen = [];
const note = (value) => { seen.push(value); return () => {}; };
const kinds = () => seen.splice(0).map((value) => typeof value).join();

@swap class Kit extends (seen.push(Kit), Object) {
  @note(Kit) field = 1;
  @note(Kit) method() {}
  @note(Kit) accessor held = 1;
  @note(Kit) get size() { return 1; }
  @note(Kit) static fixed() {}
  @note(Kit) #hidden = 1;
  @note(typeof Kit) other = 1;
  static [(seen.push(Kit), "key")] = 2;
  static [(class { static [(seen.push(Kit), "inner")] = 1; }, "nested")] = 3;
  static later = seen.push(Kit);
}
console.log(seen[7], kinds(), Kit.key);

@keep class Box {
  @note(Box) field = 1;
}
console.log(kinds());

try {
  class Plain {
    @note(Plain) field = 1;
  }
} catch (error) {
  console.log(error.name);
}
