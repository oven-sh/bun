function makeRoot(label) {
  return class Root {
    #secret = label + " secret";
    label = label;
    get secret() {
      return this.#secret;
    }
    static read(object) {
      try {
        return object.#secret;
      } catch (error) {
        return error.constructor.name;
      }
    }
    static has(object) {
      return #secret in object;
    }
  };
}
function Named(Base) {
  return class extends Base {
    name() {
      return "named " + this.label;
    }
  };
}
const first = makeRoot("first");
const second = makeRoot("second");
const classes = [];
for (let i = 0; i < 8; i++) {
  let base = i & 1 ? first : second;
  if (i & 2) base = Named(base);
  if (i & 4) base = Named(base);
  classes.push(class extends base {});
}
for (let round = 0; round < 3; round++) {
  for (const each of classes) {
    const made = new each();
    console.log(made.label, made.secret, made.name?.(), first.read(made), second.read(made), first.has(made), second.has(made));
  }
}
