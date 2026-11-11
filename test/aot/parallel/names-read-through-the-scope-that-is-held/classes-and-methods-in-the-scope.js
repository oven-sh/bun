function make(skip, name) {
  let made = 0;
  class Thing { constructor() { made++; this.name = name; } skips() { return skip; } static count() { return made + name; } }
  return { Thing, made: () => made };
}
const api = make(false, "n");
const thing = new api.Thing();
console.log(thing.name, thing.skips(), api.Thing.count(), api.made());
